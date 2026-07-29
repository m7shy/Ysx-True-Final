import { Email, EmailStatus, AppError, AppErrorCode, MailGatewayProviderKey } from '../types';
import { getAccessToken, clearAuth } from './authStorage';
import { apiGet, refreshAccessToken } from './apiClient';

const API_URL = (import.meta as any).env?.VITE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() with the same silent refresh-and-retry-once-on-401 semantics as
 * apiClient.ts's apiRequest — needed here (instead of just calling apiGet/
 * apiPost directly) because handleGatewayError below maps failures to typed,
 * provider-specific AppErrors that callers depend on, not apiClient's generic
 * ApiError. Without this, a momentarily-stale access token surfaces as a
 * false AUTH_ERROR instead of transparently refreshing (see the gwHealth fix
 * in this same file for the bug this caused in practice).
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

/**
 * Mirrors toSentItem() in server/src/mail/routes.ts. `id` is optional because
 * the server derives it from `envelope?.messageId`, which IMAP does not
 * guarantee; a `flags` field was declared here and never sent by any route, so
 * it has been dropped rather than left as a shape the client asserts and the
 * server does not produce.
 */
export interface GatewaySentItem {
  uid: number;
  id?: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
}

/** GET /api/mail/sent responds with `{ items }` and no `ok` flag. */
export interface GatewaySentResponse {
  items: GatewaySentItem[];
}

function mapGatewayItemToEmail(item: GatewaySentItem): Email {
  return {
    // Falls back to the UID: `id` is the IMAP Message-ID, which the server
    // leaves undefined when the envelope has none, and React needs a key.
    id: item.id || `uid-${item.uid}`,
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
    // Routed through apiGet (not a bare fetch) so a momentarily-expired access
    // token gets the same silent refresh-and-retry every other authenticated
    // call gets — otherwise a single stale-token race reports "unhealthy"
    // once and the caller (App.tsx) never re-checks, pinning a false warning
    // banner on for the rest of the session.
    await apiGet('/api/mail/health');
    return true;
  } catch {
    return false;
  }
}

export async function gwFetchSent(provider: MailGatewayProviderKey, limit = 20): Promise<Email[]> {
  const targetProvider = toGatewayErrorProvider(provider);

  const response = await authFetch(
    `/api/mail/sent?provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(String(limit))}`,
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

  const response = await authFetch('/api/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
