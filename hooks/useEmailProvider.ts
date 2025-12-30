import { useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { Email, EmailStatus, Recipient, AutoFollowUp, AppError, AppErrorCode, UserSettings } from '../types';
import {
  fetchSentEmails as fetchMockEmails,
  sendNewEmail as sendMockEmail,
  sendFollowUpEmail as sendMockFollowUp,
} from '../services/mockZoho';
import { fetchRealSentEmails, sendRealEmail, getZohoAccountId, refreshZohoToken } from '../services/realZoho';
import { fetchGoogleEmails, sendGoogleEmail, refreshGoogleToken } from '../services/realGoogle';
import { gwFetchSent, gwSend } from '../services/mailGateway';
import { scheduleFollowup, ProviderKeyDto } from '../services/followupApi';

type FollowupScheduleResult = {
  attempted: boolean;
  scheduled: number;
  errors: string[];
};

export type SendNewEmailResult = {
  email: Email;
  // Present only when sent via backend gateway (POST /api/mail/send)
  messageId?: string;
  // ISO timestamp used to anchor follow-up scheduling and reply checks
  initialSentAt?: string;
  followups: FollowupScheduleResult;
};

type ActiveProvider = UserSettings['activeProvider'];

type GatewayProviderKey = 'gmail' | 'zoho' | 'microsoft';

function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

function followupDelayMs(step: AutoFollowUp): number {
  const delay = Number(step.delay);
  if (!Number.isFinite(delay) || delay <= 0) return 0;

  switch (step.unit) {
    case 'MINUTES':
      return delay * 60 * 1000;
    case 'HOURS':
      return delay * 60 * 60 * 1000;
    case 'DAYS':
      return delay * 24 * 60 * 60 * 1000;
    case 'WEEKS':
      return delay * 7 * 24 * 60 * 60 * 1000;
    default:
      return delay * 24 * 60 * 60 * 1000;
  }
}

function ensureReSubject(subject: string): string {
  const s = (subject || '').trim();
  if (!s) return 'Re:';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function toGatewayProviderKey(provider: ActiveProvider): GatewayProviderKey {
  switch (provider) {
    case 'GMAIL':
      return 'gmail';
    case 'ZOHO':
      return 'zoho';
    case 'MICROSOFT':
      return 'microsoft';
    default:
      // Safe fallback (should never happen)
      return 'gmail';
  }
}

function toFollowupProviderKey(provider: ActiveProvider): ProviderKeyDto | null {
  // Follow-up scheduler backend currently only supports gmail/zoho.
  if (provider === 'GMAIL') return 'gmail';
  if (provider === 'ZOHO') return 'zoho';
  return null;
}

export const useEmailProvider = () => {
  const { settings, updateSettings } = useSettings();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  /**
   * Universal helper to execute an API call with auto-refresh logic.
   * Wraps specific provider calls to handle 401/Auth errors gracefully.
   */
  const executeWithRetry = useCallback(
    async <T,>(provider: 'ZOHO' | 'GMAIL', operation: (token: string) => Promise<T>): Promise<T> => {
      // 1. Get current token based on provider
      let token = provider === 'ZOHO' ? settings.zohoAccessToken : settings.googleAccessToken;

      // Check if we have enough to start
      if (!token && provider === 'ZOHO' && !settings.zohoRefreshToken) {
        throw new AppError(
          AppErrorCode.AUTH_EXPIRED,
          'ZOHO',
          'Zoho Access Token missing. Please connect in Settings.'
        );
      }
      if (!token && provider === 'GMAIL' && !settings.googleRefreshToken) {
        throw new AppError(
          AppErrorCode.AUTH_EXPIRED,
          'GOOGLE',
          'Google Access Token missing. Please connect in Settings.'
        );
      }

      try {
        // 2. Attempt operation with current token
        if (!token) {
          // Force refresh logic if token is missing but refresh token exists
          // Fix: Map 'GMAIL' to 'GOOGLE' for AppError type compatibility
          const errorProvider = provider === 'GMAIL' ? 'GOOGLE' : 'ZOHO';
          throw new AppError(AppErrorCode.AUTH_EXPIRED, errorProvider, 'Token missing, forcing refresh.');
        }
        return await operation(token);
      } catch (err: any) {
        // 3. Catch Auth Expiration
        if ((err instanceof AppError && err.code === AppErrorCode.AUTH_EXPIRED) || err?.status === 401) {
          // --- Handle ZOHO Refresh ---
          if (provider === 'ZOHO' && settings.zohoRefreshToken) {
            console.log('[Auto-Refresh] Zoho token expired. Refreshing...');
            try {
              const newToken = await refreshZohoToken(
                settings.zohoRegion,
                settings.zohoClientId,
                settings.zohoClientSecret,
                settings.zohoRefreshToken
              );

              // Update Context with new token
              updateSettings({ zohoAccessToken: newToken });

              // Retry Operation with NEW token
              console.log('[Auto-Refresh] Success. Retrying operation...');
              return await operation(newToken);
            } catch (refreshErr) {
              console.error('[Auto-Refresh] Failed to refresh token.', refreshErr);
              throw new AppError(
                AppErrorCode.AUTH_EXPIRED,
                'ZOHO',
                'Session expired. Please reconnect Zoho in Settings.'
              );
            }
          }

          // --- Handle Google Refresh ---
          if (
            provider === 'GMAIL' &&
            settings.googleRefreshToken &&
            settings.googleClientId &&
            settings.googleClientSecret
          ) {
            console.log('[Auto-Refresh] Google token expired. Refreshing...');
            try {
              const newToken = await refreshGoogleToken(
                settings.googleClientId,
                settings.googleClientSecret,
                settings.googleRefreshToken
              );

              // Update Context
              updateSettings({ googleAccessToken: newToken });

              // Retry
              console.log('[Auto-Refresh] Google Success. Retrying operation...');
              return await operation(newToken);
            } catch (refreshErr) {
              console.error('[Auto-Refresh] Failed to refresh Google token.', refreshErr);
              throw new AppError(
                AppErrorCode.AUTH_EXPIRED,
                'GOOGLE',
                'Session expired. Please reconnect Google in Settings.'
              );
            }
          }
        }
        throw err;
      }
    },
    [settings, updateSettings]
  );

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (settings.useRealApi) {
        // --- GATEWAY MODE ---
        if (settings.transportMode === 'gateway-imap-smtp') {
          const gatewayProviderKey = toGatewayProviderKey(settings.activeProvider);
          const data = await gwFetchSent(gatewayProviderKey);
          setEmails(data);
        }
        // --- OAUTH API MODE (Legacy) ---
        else {
          // Microsoft OAuth is not implemented in this app.
          if (settings.activeProvider === 'MICROSOFT') {
            throw new AppError(
              AppErrorCode.VALIDATION,
              'SYSTEM',
              "Microsoft is only supported in Gateway mode (IMAP/SMTP). Switch Transport Mode to 'Email Gateway'."
            );
          }

          if (settings.activeProvider === 'GMAIL') {
            const data = await executeWithRetry('GMAIL', async (token) => {
              return await fetchGoogleEmails(token);
            });
            setEmails(data);
          } else {
            const data = await executeWithRetry('ZOHO', async (token) => {
              let accountId = settings.zohoAccountId;
              if (!accountId) {
                accountId = await getZohoAccountId(token, settings.zohoRegion);
                updateSettings({ zohoAccountId: accountId });
              }
              return await fetchRealSentEmails(token, accountId, settings.zohoRegion);
            });
            setEmails(data);
          }
        }
      } else {
        // --- MOCK MODE ---
        const data = await fetchMockEmails();
        setEmails(data);
      }
    } catch (err: any) {
      if (err instanceof AppError) {
        setError(err);
      } else {
        console.error('Load Emails Failed', err);
        setError(new AppError(AppErrorCode.UNKNOWN, 'SYSTEM', err?.message || 'Failed to connect.'));
      }
    } finally {
      setLoading(false);
    }
  }, [settings, updateSettings, executeWithRetry]);

  const sendNewEmail = useCallback(
    async (
      recipient: Recipient,
      subject: string,
      body: string,
      autoFollowUps?: AutoFollowUp[],
      options?: { campaignId?: string; leadId?: string }
    ): Promise<SendNewEmailResult> => {
      const followups: FollowupScheduleResult = {
        attempted: false,
        scheduled: 0,
        errors: [],
      };

      if (settings.useRealApi) {
        const gatewayProviderKey = toGatewayProviderKey(settings.activeProvider);
        const followupProviderKey = toFollowupProviderKey(settings.activeProvider);

        const normalizedRecipient = normalizeEmail(recipient.email);

        let messageId: string | undefined;

        // --- GATEWAY MODE (recommended; required for backend follow-ups) ---
        if (settings.transportMode === 'gateway-imap-smtp') {
          const result = await gwSend(gatewayProviderKey, {
            to: normalizedRecipient,
            subject,
            body,
          });
          messageId = result.messageId;
        }
        // --- OAUTH API MODE (Legacy) ---
        else {
          // Microsoft OAuth is not implemented in this app.
          if (settings.activeProvider === 'MICROSOFT') {
            throw new AppError(
              AppErrorCode.VALIDATION,
              'SYSTEM',
              "Microsoft is only supported in Gateway mode (IMAP/SMTP). Switch Transport Mode to 'Email Gateway'."
            );
          }

          if (settings.activeProvider === 'GMAIL') {
            await executeWithRetry('GMAIL', async (token) => {
              await sendGoogleEmail(token, normalizedRecipient, subject, body);
            });
          } else {
            await executeWithRetry('ZOHO', async (token) => {
              let accountId = settings.zohoAccountId;
              if (!accountId) {
                accountId = await getZohoAccountId(token, settings.zohoRegion);
                updateSettings({ zohoAccountId: accountId });
              }
              await sendRealEmail(token, accountId, settings.zohoRegion, normalizedRecipient, subject, body);
            });
          }
        }

        // Record sent time AFTER successful send (avoids false-positive reply checks).
        const initialSentAt = new Date().toISOString();

        // Optimistic UI Update
        const newEmail: Email = {
          id: `real_${Date.now()}_${Math.random()}`,
          recipient: normalizedRecipient,
          recipientName: recipient.name,
          company: recipient.company,
          subject: subject,
          body: body,
          sentDate: initialSentAt,
          status: EmailStatus.NO_REPLY,
          provider: settings.activeProvider,
        };

        setEmails((prev) => [newEmail, ...prev]);

        // Schedule follow-ups on backend (requires gateway mode + messageId)
        if (
          settings.transportMode === 'gateway-imap-smtp' &&
          options?.campaignId &&
          messageId &&
          Array.isArray(autoFollowUps) &&
          autoFollowUps.length > 0
        ) {
          followups.attempted = true;

          if (!followupProviderKey) {
            // We intentionally do not schedule follow-ups for Microsoft until the backend supports it.
            followups.errors.push('Follow-up scheduling is currently supported only for Gmail and Zoho.');
          } else {
            let cumulativeDelay = 0;
            const initialMs = Date.parse(initialSentAt);

            for (let i = 0; i < autoFollowUps.length; i++) {
              const step = autoFollowUps[i];
              cumulativeDelay += followupDelayMs(step);

              const scheduledAt = new Date(initialMs + cumulativeDelay).toISOString();
              const followupSubject = ensureReSubject(subject);

              try {
                await scheduleFollowup({
                  provider: followupProviderKey,
                  to: normalizedRecipient,
                  subject: followupSubject,
                  body: step.content,
                  scheduledAt,

                  // REQUIRED by backend
                  campaignId: options.campaignId,
                  recipientEmail: normalizedRecipient,
                  originalMessageId: messageId,
                  initialSentAt,

                  // Helpful optional metadata
                  leadId: options.leadId,
                  originalEmailId: newEmail.id,
                  stepIndex: i + 1,

                  // Default behavior: do not send if recipient replied
                  skipIfReplied: true,
                });

                followups.scheduled += 1;
              } catch (err: any) {
                const msg = err?.message ? String(err.message) : String(err);
                followups.errors.push(`Step ${i + 1}: ${msg}`);
              }
            }
          }
        }

        return {
          email: newEmail,
          messageId,
          initialSentAt,
          followups,
        };
      }

      // --- MOCK MODE ---
      const newEmail = await sendMockEmail(
        recipient.email,
        recipient.name,
        recipient.company,
        subject,
        body,
        autoFollowUps
      );
      setEmails((prev) => [newEmail, ...prev]);

      return {
        email: newEmail,
        followups,
      };
    },
    [settings, updateSettings, executeWithRetry]
  );

  const sendFollowUp = useCallback(
    async (email: Email, content: string, date?: string) => {
      if (settings.useRealApi) {
        if (date) {
          console.warn('Real API Scheduling requires a backend queue.');
          // In a production app, this would send a payload to your scheduler backend
        } else {
          const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;

          // --- GATEWAY MODE ---
          if (settings.transportMode === 'gateway-imap-smtp') {
            const gatewayProviderKey = toGatewayProviderKey(settings.activeProvider);
            await gwSend(gatewayProviderKey, {
              to: email.recipient,
              subject,
              body: content,
            });
          }
          // --- OAUTH API MODE ---
          else {
            // Microsoft OAuth is not implemented in this app.
            if (settings.activeProvider === 'MICROSOFT') {
              throw new AppError(
                AppErrorCode.VALIDATION,
                'SYSTEM',
                "Microsoft is only supported in Gateway mode (IMAP/SMTP). Switch Transport Mode to 'Email Gateway'."
              );
            }

            if (settings.activeProvider === 'GMAIL') {
              await executeWithRetry('GMAIL', async (token) => {
                await sendGoogleEmail(token, email.recipient, subject, content);
              });
            } else {
              await executeWithRetry('ZOHO', async (token) => {
                let accountId = settings.zohoAccountId;
                if (!accountId) {
                  accountId = await getZohoAccountId(token, settings.zohoRegion);
                  updateSettings({ zohoAccountId: accountId });
                }
                await sendRealEmail(token, accountId, settings.zohoRegion, email.recipient, subject, content);
              });
            }
          }
        }
      } else {
        await sendMockFollowUp(email.id, content, date);
      }

      // Update local state (Optimistic)
      setEmails((prev) =>
        prev.map((e) =>
          e.id === email.id
            ? {
                ...e,
                status: date ? EmailStatus.SCHEDULED : EmailStatus.FOLLOW_UP_SENT,
                scheduledDate: date,
                followupHistory: [
                  ...(e.followupHistory || []),
                  {
                    date: date || new Date().toISOString(),
                    content: content,
                    status: date ? 'SCHEDULED' : 'SENT',
                  },
                ],
              }
            : e
        )
      );
    },
    [settings, updateSettings, executeWithRetry]
  );

  return { emails, loading, error, loadEmails, sendNewEmail, sendFollowUp, setEmails };
};
