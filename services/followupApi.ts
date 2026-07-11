import { AppError, AppErrorCode } from '../types';
import { getAccessToken } from './authStorage';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  campaignId: string;
  recipientEmail: string;
  originalMessageId: string;
  initialSentAt: string;
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
    const response = await fetch(`${API_URL}/api/followups/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
    const response = await fetch(`${API_URL}/api/followups`, { headers: authHeaders() });
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
    const response = await fetch(`${API_URL}/api/followups/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
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
