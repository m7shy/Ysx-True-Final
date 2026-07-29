import { AppError, AppErrorCode } from '../types';
import { clearAuth } from './authStorage';
import { refreshAccessToken } from './apiClient';
import { getAccessToken } from './authStorage';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() with the same silent refresh-and-retry-once-on-401 semantics as
 * apiClient.ts's apiRequest — needed here (instead of just calling apiPost/
 * apiGet directly) because the three follow-up functions below map failures
 * to typed, provider-specific AppErrors that callers depend on, not
 * apiClient's generic ApiError. Without this, a momentarily-stale access
 * token causes the call to fail with a misleading PROVIDER_ERROR with no
 * refresh attempt (same class of bug fixed twice already in mailGateway.ts).
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, ...authHeaders() },
    });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearAuth();
    }
  }

  return res;
}

export type ProviderKeyDto = 'gmail' | 'zoho' | 'microsoft';

export interface FollowupJobDto {
  id: string;
  provider: ProviderKeyDto;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;
  campaignId: string;
  recipientEmail: string;
  originalMessageId: string;
  initialSentAt: string;
  stepIndex?: number;
  status?: 'scheduled' | 'sent' | 'cancelled' | 'failed';
  lastError?: string;
  createdAt?: string;
  sentAt?: string;
  cancelledAt?: string;
}

export interface ScheduleFollowupInput {
  provider: ProviderKeyDto;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;
  recipientEmail: string;
  initialSentAt: string;
  /**
   * Optional, matching the server (`campaignId: z.string().min(1).optional()`).
   * A one-off follow-up composed on the Dashboard belongs to no campaign.
   *
   * Never synthesise a value to fill this in: sendFollowupJob looks the id up
   * and cancels the job as `campaign_deleted` when it does not resolve, so a
   * fake id yields a follow-up that is accepted, displayed as scheduled, and
   * then silently dropped at send time.
   */
  campaignId?: string;
  /**
   * Optional: IMAP does not guarantee a Message-ID, and mailGateway derives it
   * from `envelope?.messageId`. Reply detection degrades to
   * In-Reply-To/References and then the thread subject without it.
   */
  originalMessageId?: string;
  stepIndex?: number;
  skipIfReplied?: boolean;
  onlyIfNoReply?: boolean;
}

const providerToAppErrorTarget = (provider: ProviderKeyDto): 'ZOHO' | 'GOOGLE' | 'MICROSOFT' => {
  if (provider === 'microsoft') return 'MICROSOFT';
  return provider === 'gmail' ? 'GOOGLE' : 'ZOHO';
};

async function parseJsonResponse(
  response: Response,
  provider: 'ZOHO' | 'GOOGLE' | 'MICROSOFT' | 'SYSTEM'
) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response
    throw new AppError(
      AppErrorCode.UNKNOWN,
      provider,
      `Invalid server response format: ${text?.slice(0, 200) ?? ''}`
    );
  }
}

export async function scheduleFollowup(input: ScheduleFollowupInput): Promise<{ job: FollowupJobDto }> {
  const provider = providerToAppErrorTarget(input.provider);
  try {
    const response = await authFetch(`/api/followups/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const data = await parseJsonResponse(response, provider);
    if (!response.ok) {
      throw new AppError(AppErrorCode.PROVIDER_ERROR, provider, data?.message || 'Failed to schedule follow-up.');
    }
    return data as { job: FollowupJobDto };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown follow-up scheduling error';
    throw new AppError(AppErrorCode.NETWORK_ERROR, provider, message);
  }
}

export async function listFollowups(): Promise<{ jobs: FollowupJobDto[] }> {
  try {
    const response = await authFetch(`/api/followups`);
    const data = await parseJsonResponse(response, 'SYSTEM');
    if (!response.ok) {
      throw new AppError(AppErrorCode.PROVIDER_ERROR, 'SYSTEM', 'Failed to list follow-ups.');
    }
    return data as { jobs: FollowupJobDto[] };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown follow-up fetch error';
    throw new AppError(AppErrorCode.NETWORK_ERROR, 'SYSTEM', message);
  }
}

export async function cancelFollowup(id: string): Promise<{ ok: boolean }> {
  try {
    const response = await authFetch(`/api/followups/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
    const data = await parseJsonResponse(response, 'SYSTEM');
    if (!response.ok) {
      throw new AppError(AppErrorCode.PROVIDER_ERROR, 'SYSTEM', 'Failed to cancel follow-up.');
    }
    return data as { ok: boolean };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown follow-up cancel error';
    throw new AppError(AppErrorCode.NETWORK_ERROR, 'SYSTEM', message);
  }
}
