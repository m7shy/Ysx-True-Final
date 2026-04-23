import { Email, EmailStatus, AppError, AppErrorCode } from '../types';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export type MailGatewayProviderKey = 'gmail' | 'zoho' | 'microsoft';

interface GatewaySentItem {
  uid: number;
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
}

interface GatewaySendInput {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ name: string; dataBase64: string; mime?: string }>;
}

type GatewayErrorProvider = 'ZOHO' | 'GOOGLE' | 'MICROSOFT';

function toGatewayErrorProvider(provider: MailGatewayProviderKey): GatewayErrorProvider {
  switch (provider) {
    case 'gmail':
      return 'GOOGLE';
    case 'zoho':
      return 'ZOHO';
    case 'microsoft':
      return 'MICROSOFT';
    default:
      return 'GOOGLE';
  }
}

function toEmailProvider(provider: MailGatewayProviderKey): 'GMAIL' | 'ZOHO' | 'MICROSOFT' {
  switch (provider) {
    case 'gmail':
      return 'GMAIL';
    case 'zoho':
      return 'ZOHO';
    case 'microsoft':
      return 'MICROSOFT';
    default:
      return 'GMAIL';
  }
}

const handleGatewayError = async (response: Response, provider: GatewayErrorProvider) => {
  if (response.ok) {
    return response.json();
  }

  let errorData: any;
  try {
    errorData = await response.json();
  } catch {
    throw new AppError(AppErrorCode.NETWORK_ERROR, provider, response.statusText);
  }

  const msg =
    errorData?.message ||
    errorData?.error ||
    (Array.isArray(errorData?.errors) ? errorData.errors.join(', ') : null) ||
    'Unknown Gateway Error';

  const code = String(errorData?.code || '').toUpperCase();

  switch (code) {
    case 'AUTH':
      throw new AppError(AppErrorCode.AUTH_EXPIRED, provider, msg);

    case 'DENIED':
      throw new AppError(AppErrorCode.ACCESS_DENIED, provider, msg);

    case 'TIMEOUT':
    case 'TRANSIENT':
      throw new AppError(AppErrorCode.NETWORK_ERROR, provider, msg);

    case 'MAILBOX_NOT_FOUND':
    case 'NOT_FOUND':
      throw new AppError(AppErrorCode.NOT_FOUND, provider, msg);

    case 'INVALID_PROVIDER':
    case 'INVALID_UID':
    case 'INVALID_INPUT':
    case 'VALIDATION':
      throw new AppError(AppErrorCode.VALIDATION, provider, msg);

    default:
      // Fallback mapping based on HTTP status when backend code isn't present
      if (response.status === 401) throw new AppError(AppErrorCode.AUTH_EXPIRED, provider, msg);
      if (response.status === 403) throw new AppError(AppErrorCode.ACCESS_DENIED, provider, msg);
      if (response.status === 404) throw new AppError(AppErrorCode.NOT_FOUND, provider, msg);
      if (response.status === 429 || response.status === 503) {
        throw new AppError(AppErrorCode.RATE_LIMIT, provider, msg);
      }
      throw new AppError(AppErrorCode.UNKNOWN, provider, msg);
  }
};

export async function gwHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/mail/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function gwFetchSent(provider: MailGatewayProviderKey, limit = 20): Promise<Email[]> {
  const targetProvider = toGatewayErrorProvider(provider);

  try {
    const response = await fetch(
      `${API_URL}/api/mail/sent?provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(String(limit))}`
    );
    const data = await handleGatewayError(response, targetProvider);

    return (data.items as GatewaySentItem[]).map((item) => ({
      id: `${provider}:${String(item.uid)}`,
      recipient: item.to[0] || 'unknown',
      recipientName: item.to[0] ? item.to[0].split('@')[0] : 'Unknown',
      company: 'External',
      subject: item.subject,
      body: item.snippet,
      sentDate: item.date,
      status: EmailStatus.NO_REPLY,
      provider: toEmailProvider(provider),
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(AppErrorCode.NETWORK_ERROR, targetProvider, message);
  }
}

export async function gwSend(
  provider: MailGatewayProviderKey,
  input: GatewaySendInput
): Promise<{ messageId: string }> {
  const targetProvider = toGatewayErrorProvider(provider);

  try {
    // IMPORTANT:
    //  - Backend enforces SMTP "from" as the authenticated mailbox user from ENV.
    //  - If client sends a "from", backend treats it as Reply-To.
    // So we DO NOT send a fake "from" from the client.
    const payload: any = {
      provider,
      to: input.to,
      subject: input.subject,
      body: input.body,
    };

    if (input.attachments && input.attachments.length > 0) {
      // (Backend currently ignores attachments, but this matches the common schema if enabled later.)
      payload.attachments = input.attachments.map((att) => ({
        filename: att.name,
        contentBase64: att.dataBase64,
        contentType: att.mime,
      }));
    }

    const response = await fetch(`${API_URL}/api/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await handleGatewayError(response, targetProvider);
    return { messageId: data.messageId };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(AppErrorCode.NETWORK_ERROR, targetProvider, message);
  }
}
