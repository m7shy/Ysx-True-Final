import { AppError, AppErrorCode } from '../types';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export type ProviderKeyDto = 'gmail' | 'zoho' | 'microsoft';

export interface FollowupJobDto {
  id: string;
  provider: ProviderKeyDto;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  scheduledAt: string;
  createdAt: string;
  sentAt?: string;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  lastError?: string;
  campaignId?: string;
  recipientEmail?: string;
  originalMessageId?: string;
  initialSentAt?: string;
  leadId?: string;
  originalEmailId?: string;
  stepIndex?: number;
  skipIfReplied?: boolean;
  onlyIfNoReply?: boolean;
}

export interface ScheduleFollowupInput {
  provider: ProviderKeyDto;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;

  // Required by server/src/followups/routes.ts
  campaignId: string;
  recipientEmail: string;
  originalMessageId: string;
  initialSentAt: string;

  // Optional metadata
  replyTo?: string;
  leadId?: string;
  originalEmailId?: string;
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
  let data: any = null;

  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to parse follow-up scheduler response.';
    throw new AppError(AppErrorCode.NETWORK_ERROR, provider, message);
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      (Array.isArray(data?.errors) ? data.errors.join(', ') : null) ||
      response.statusText ||
      'Failed to schedule follow-up';

    throw new AppError(AppErrorCode.NETWORK_ERROR, provider, message);
  }

  return data;
}

export async function scheduleFollowup(input: ScheduleFollowupInput): Promise<{ job: FollowupJobDto }> {
  const provider = providerToAppErrorTarget(input.provider);

  try {
    const response = await fetch(`${API_URL}/api/followups/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const data = await parseJsonResponse(response, provider);
    return data as { job: FollowupJobDto };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown follow-up scheduling error';
    throw new AppError(AppErrorCode.NETWORK_ERROR, provider, message);
  }
}

export async function listFollowups(): Promise<{ jobs: FollowupJobDto[] }> {
  try {
    const response = await fetch(`${API_URL}/api/followups`);
    const data = await parseJsonResponse(response, 'SYSTEM');
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
    });

    const data = await parseJsonResponse(response, 'SYSTEM');
    return data as { ok: boolean };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown follow-up cancel error';
    throw new AppError(AppErrorCode.NETWORK_ERROR, 'SYSTEM', message);
  }
}
