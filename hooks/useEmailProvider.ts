import { useState, useCallback } from 'react';
import { AppError, AppErrorCode, Email, EmailStatus } from '../types';
import { useSettings } from '../context/SettingsContext';
import type { AutoFollowUp } from '../types';

import { gwFetchSent, gwSend } from '../services/mailGateway';
import { scheduleFollowup, type ProviderKeyDto } from '../services/followupApi';
import type { ActiveProvider, MailGatewayProviderKey as GatewayProviderKey } from '../types';

type FollowupsSummary = {
  attempted: boolean;
  scheduled: number;
  errors: string[];
};

type FollowupScheduleResult =
  | { success: true }
  | { success: false; error: AppError };

type SendEmailResult = {
  success: boolean;
  messageId?: string;
  error?: AppError;
  followups: FollowupsSummary;
  scheduledFollowUps?: FollowupScheduleResult[];
};

type RecipientLike = string | { email?: string };

type SendNewEmailOptions = {
  campaignId?: string;
};

function withSignature(body: string, signature?: string): string {
  if (!signature?.trim()) return body;
  return `${body}\n\n${signature}`;
}

function followUpDelayToMs(delay: number, unit: AutoFollowUp['unit']): number {
  switch (unit) {
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

function toReplySubject(originalSubject: string): string {
  const s = (originalSubject || '').trim();
  if (!s) return 'Re:';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

// Map UI provider to gateway provider key
function toGatewayProviderKey(provider: ActiveProvider): GatewayProviderKey {
  switch (provider) {
    case 'GMAIL':
      return 'gmail';
    case 'MICROSOFT':
      return 'microsoft';
    case 'ZOHO':
      return 'zoho';
    default:
      return 'gmail';
  }
}

// Map UI provider enum to followup provider key (follow-ups are scheduled via
// backend gateway; the scheduler backend only supports gmail/zoho/microsoft —
// which is every member of ActiveProvider, so this is exhaustive/non-null).
function toFollowupProviderKey(provider: ActiveProvider): ProviderKeyDto {
  if (provider === 'GMAIL') return 'gmail';
  if (provider === 'ZOHO') return 'zoho';
  return 'microsoft';
}

export const useEmailProvider = () => {
  const { settings, updateSettings } = useSettings();

  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);
  const [error, setError] = useState<AppError | null>(null);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!settings.useRealApi) {
        // Mock data
        await new Promise((resolve) => setTimeout(resolve, 500));
        setEmails([
          {
            id: 'mock-1',
            subject: 'Welcome!',
            body: 'Thanks for trying the app.',
            date: new Date().toISOString(),
            status: EmailStatus.SENT,
            followUpHistory: [],
            to: 'test@example.com',
            from: 'me@example.com',
            messageId: '<mock-1@example.com>',
          },
        ]);
        return;
      }

      // Real API mode — always uses the server-side gateway (IMAP/SMTP).
      const providerKey = toGatewayProviderKey(settings.activeProvider);
      const fetched = await gwFetchSent(providerKey, 20);
      setEmails(fetched);
    } catch (err: any) {
      console.error('Failed to load emails:', err);
      if (err instanceof AppError) {
        setError(err);
      } else {
        setError(new AppError(AppErrorCode.UNKNOWN, 'SYSTEM', err?.message || 'Unknown error'));
      }
    } finally {
      setLoading(false);
    }
  }, [settings]);

  const sendNewEmail = useCallback(
    async (
      to: RecipientLike,
      subject: string,
      body: string,
      autoFollowUps: AutoFollowUp[] = [],
      options?: { campaignId?: string }
    ): Promise<SendEmailResult> => {
      setLoading(true);
      setError(null);

      const baseFollowups: FollowupsSummary = { attempted: false, scheduled: 0, errors: [] };

      try {
        const rawTo = typeof to === 'string' ? to : String(to?.email ?? '');
        const normalizedTo = rawTo.trim().toLowerCase();

        if (!normalizedTo) {
          throw new AppError(AppErrorCode.INVALID_INPUT, 'SYSTEM', 'Recipient email is required.');
        }

        if (!settings.useRealApi) {
          // Mock send
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, followups: baseFollowups };
        }

        // Real API mode — always uses the server-side gateway (IMAP/SMTP).
        const gatewayProviderKey = toGatewayProviderKey(settings.activeProvider);

        try {
          const bodyWithSig = withSignature(body, settings.emailSignature);

          const sendRes = await gwSend(gatewayProviderKey, {
            to: normalizedTo,
            subject,
            body: bodyWithSig,
          });

          const originalMessageId = sendRes.messageId;
          const initialSentAt = new Date().toISOString();

          // Schedule follow-ups if requested
          const followUpResults: FollowupScheduleResult[] = [];
          const followups: FollowupsSummary = {
            attempted: autoFollowUps.length > 0,
            scheduled: 0,
            errors: [],
          };

          if (autoFollowUps.length > 0) {
            const providerKey = toFollowupProviderKey(settings.activeProvider);

            // Use caller-provided campaign id (so UI + backend agree on the same campaign).
            // Fallback to a generated id for backwards compatibility.
            const campaignId = (options?.campaignId || '').trim() || `camp_${Date.now()}`;

            for (let i = 0; i < autoFollowUps.length; i++) {
              const followUp = autoFollowUps[i];
              const delayMs = followUpDelayToMs(followUp.delay, followUp.unit);
              const scheduledAtIso = new Date(Date.now() + delayMs).toISOString();

              const followUpBody = withSignature(followUp.content, settings.emailSignature);

              try {
                await scheduleFollowup({
                  provider: providerKey,
                  to: normalizedTo,
                  subject: toReplySubject(subject),
                  body: followUpBody,
                  scheduledAt: scheduledAtIso,

                  campaignId,
                  recipientEmail: normalizedTo,
                  originalMessageId,
                  initialSentAt,

                  stepIndex: i + 1,
                  skipIfReplied: true,
                });

                followUpResults.push({ success: true });
                followups.scheduled += 1;
              } catch (e: any) {
                const appErr =
                  e instanceof AppError
                    ? e
                    : new AppError(AppErrorCode.UNKNOWN, 'SYSTEM', e?.message || 'Failed to schedule follow-up.');
                followUpResults.push({ success: false, error: appErr });
                followups.errors.push(appErr.message);
              }
            }
          }

          return {
            success: true,
            messageId: originalMessageId,
            followups,
            scheduledFollowUps: followUpResults,
          };
        } catch (error) {
          console.error('Gateway send failed:', error);
          const appError =
            error instanceof AppError
              ? error
              : new AppError(
                  AppErrorCode.PROVIDER_ERROR,
                  'SYSTEM',
                  error instanceof Error ? error.message : 'Send failed'
                );
          setError(appError);
          return { success: false, error: appError, followups: baseFollowups };
        }
      } catch (err: any) {
        console.error('Failed to send email:', err);
        const appErr =
          err instanceof AppError ? err : new AppError(AppErrorCode.UNKNOWN, 'SYSTEM', err?.message || 'Unknown error');
        setError(appErr);
        return { success: false, error: appErr, followups: { attempted: false, scheduled: 0, errors: [] } };
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  const sendFollowUp = useCallback(
    async (originalEmail: Email, followUpContent: string): Promise<SendEmailResult> => {
      setLoading(true);
      setError(null);

      const baseFollowups: FollowupsSummary = { attempted: false, scheduled: 0, errors: [] };

      try {
        const subject = toReplySubject(originalEmail.subject);
        const to = originalEmail.to;

        if (!settings.useRealApi) {
          // Mock send follow-up
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, followups: baseFollowups };
        }

        // Real API mode — always uses the server-side gateway (IMAP/SMTP).
        const providerKey = toGatewayProviderKey(settings.activeProvider);

        await gwSend(providerKey, {
          to,
          subject,
          body: withSignature(followUpContent, settings.emailSignature),
          inReplyTo: originalEmail.messageId,
          references: originalEmail.messageId,
        });

        return { success: true, followups: baseFollowups };
      } catch (err: any) {
        console.error('Failed to send follow-up:', err);
        const appErr =
          err instanceof AppError ? err : new AppError(AppErrorCode.UNKNOWN, 'SYSTEM', err?.message || 'Unknown error');
        setError(appErr);
        return { success: false, error: appErr, followups: baseFollowups };
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  return {
    loading,
    emails,
    error,
    settings,
    loadEmails,
    sendNewEmail,
    sendFollowUp,
    updateSettings,
  };
}
