import { Email, EmailStatus, AppError, AppErrorCode, MailGatewayProviderKey } from '../types';
import { getAccessToken } from './authStorage';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface GatewaySentItem {
  uid: number;
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
  flags: string[];
}

export interface GatewaySentResponse {
  ok: boolean;
  items: GatewaySentItem[];
}

function mapGatewayItemToEmail(item: GatewaySentItem): Email {
  return {
    id: item.id,
    subject: item.subject,
    body: item.snippet || '',
    date: item.date,
    status: EmailStatus.SENT,
    followUpHistory: [],
    to: item.to[0] || '',
    from: item.from,
    messageId: item.id || undefined,
  };
}

type GatewayErrorProvider = 'ZOHO' | 'GOOGLE' | 'MICROSOFT';

function toGatewayErrorProvider(provider: MailGatewayProviderKey): GatewayErrorProvider {
  switch (provider) {
    case 'gmail':
      return 'GOOGLE';
    case 'microsoft':
      return 'MICROSOFT';
    case 'zoho':
    default:
      return 'ZOHO';
  }
}

const handleGatewayError = async (response: Response, provider: GatewayErrorProvider) => {
  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorData = await response.json();
      errorDetail = errorData.message || errorData.error || JSON.stringify(errorData);
    } catch {
      errorDetail = await response.text();
    }

    const statusCode = response.status;

    if (statusCode === 401) {
      throw new AppError(AppErrorCode.AUTH_ERROR, provider, errorDetail || 'Authentication failed.');
    } else if (statusCode === 429) {
      throw new AppError(AppErrorCode.RATE_LIMIT, provider, 'Rate limit exceeded.');
    } else if (statusCode >= 500) {
      throw new AppError(AppErrorCode.PROVIDER_ERROR, provider, 'Mail gateway server error.');
    } else {
      throw new AppError(AppErrorCode.UNKNOWN, provider, errorDetail || 'Unknown gateway error.');
    }
  }

  // Safe JSON parse
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export async function gwHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/mail/health`, { headers: authHeaders() });
    return response.ok;
  } catch {
    return false;
  }
}

export async function gwFetchSent(provider: MailGatewayProviderKey, limit = 20): Promise<Email[]> {
  const targetProvider = toGatewayErrorProvider(provider);

  const response = await fetch(
    `${API_URL}/api/mail/sent?provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(String(limit))}`,
    { headers: authHeaders() }
  );
  const data = (await handleGatewayError(response, targetProvider)) as GatewaySentResponse;
  return (data.items || []).map(mapGatewayItemToEmail);
}

export interface GwSendInput {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

export async function gwSend(provider: MailGatewayProviderKey, input: GwSendInput): Promise<{ messageId: string }> {
  const targetProvider = toGatewayErrorProvider(provider);

  const response = await fetch(`${API_URL}/api/mail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      provider,
      to: input.to,
      subject: input.subject,
      // Backend expects "text" for the message body.
      // (See server/src/mail/routes.ts POST /api/mail/send)
      text: input.body,
      inReplyTo: input.inReplyTo,
      references: input.references,
    }),
  });

  const data = await handleGatewayError(response, targetProvider);
  return { messageId: String((data as any)?.messageId ?? '') };
}
