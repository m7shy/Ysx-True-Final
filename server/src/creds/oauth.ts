import { MailError } from '../httpErrors.js';

/**
 * Provider OAuth2 refresh-token exchange (pure HTTP; no database).
 *
 * Given a decrypted refresh token this mints a fresh access token from the
 * provider's token endpoint. The app-registration credentials (client id /
 * secret) are app-level config read from the environment — these are NOT
 * per-user secrets, unlike the token records which live per-mailbox in the DB.
 */

export type OAuthProvider = 'gmail' | 'microsoft';

export interface RefreshResult {
  accessToken: string;
  // Providers may rotate the refresh token; when present, persist the new one.
  refreshToken?: string;
  // Absolute expiry computed from the provider's expires_in.
  expiresAt: Date;
  scope?: string;
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface AuthCodeResult {
  accessToken: string;
  // Present when the provider issues a refresh token (Google needs
  // access_type=offline + prompt=consent; Microsoft needs the offline_access scope).
  refreshToken?: string;
  // OIDC id_token (present when the `openid`/`email` scopes are requested); the
  // caller decodes it to learn which mailbox the user just consented to connect.
  idToken?: string;
  expiresAt: Date;
  scope?: string;
}

async function postForm(url: string, params: URLSearchParams): Promise<{ ok: boolean; status: number; body: TokenEndpointResponse; raw: string }> {
  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const raw = await res.text();
  let body: TokenEndpointResponse = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // leave body empty; raw carries the detail
  }
  return { ok: res.ok, status: res.status, body, raw };
}

function toExpiry(expiresIn: number | undefined): Date {
  // Default to the common 1-hour lifetime when the provider omits expires_in.
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000);
}

async function refreshGoogle(refreshToken: string, scope?: string): Promise<RefreshResult> {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MailError('AUTH', 'Missing GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET');
  }

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const { ok, body, raw } = await postForm('https://oauth2.googleapis.com/token', params);
  if (!ok || !body.access_token) {
    throw new MailError(
      'AUTH',
      `Google token refresh failed: ${body.error_description || raw.slice(0, 200)}`,
      body.error === 'invalid_grant',
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token, // Google usually omits; keep existing if undefined
    expiresAt: toExpiry(body.expires_in),
    scope: body.scope ?? scope,
  };
}

async function refreshMicrosoft(refreshToken: string, tenant: string | null, scope?: string): Promise<RefreshResult> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId) {
    throw new MailError('AUTH', 'Missing MICROSOFT_CLIENT_ID');
  }

  const authority = process.env.MICROSOFT_OAUTH_AUTHORITY || 'https://login.microsoftonline.com';
  const tenantSegment = tenant || process.env.MICROSOFT_TENANT_ID || 'common';
  const url = `${authority}/${tenantSegment}/oauth2/v2.0/token`;
  const effectiveScope = scope || 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access';

  const build = (secret?: string) => {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    if (secret) params.append('client_secret', secret);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    params.append('scope', effectiveScope);
    return params;
  };

  let result = await postForm(url, build(clientSecret));

  // Public-client app registrations reject a client_secret (AADSTS700025); retry without it.
  if (!result.ok && clientSecret) {
    const detail = result.body.error_description || result.raw;
    if (detail.includes('AADSTS700025')) {
      result = await postForm(url, build(undefined));
    }
  }

  if (!result.ok || !result.body.access_token) {
    throw new MailError(
      'AUTH',
      `Microsoft token refresh failed: ${result.body.error_description || result.raw.slice(0, 200)}`,
      result.body.error === 'invalid_grant',
    );
  }

  return {
    accessToken: result.body.access_token,
    refreshToken: result.body.refresh_token,
    expiresAt: toExpiry(result.body.expires_in),
    scope: result.body.scope ?? effectiveScope,
  };
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  input: { refreshToken: string; tenant?: string | null; scope?: string },
): Promise<RefreshResult> {
  if (provider === 'gmail') return refreshGoogle(input.refreshToken, input.scope);
  return refreshMicrosoft(input.refreshToken, input.tenant ?? null, input.scope);
}

/**
 * Authorization-code exchange (the second leg of the interactive consent flow).
 *
 * The OAuth callback route hands us the one-time `code` the provider issued to
 * the browser; here we trade it — server-to-server with the backend client
 * credentials — for the durable access + refresh tokens that get persisted
 * (encrypted) on the Mailbox. `redirectUri` MUST byte-for-byte match the one
 * used to build the authorize URL, or the provider rejects the exchange.
 */
async function exchangeGoogleCode(code: string, redirectUri: string): Promise<AuthCodeResult> {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MailError('AUTH', 'Missing GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET');
  }

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', redirectUri);

  const { ok, body, raw } = await postForm('https://oauth2.googleapis.com/token', params);
  if (!ok || !body.access_token) {
    throw new MailError('AUTH', `Google code exchange failed: ${body.error_description || raw.slice(0, 200)}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
    expiresAt: toExpiry(body.expires_in),
    scope: body.scope,
  };
}

async function exchangeMicrosoftCode(
  code: string,
  redirectUri: string,
  tenant: string | null,
  scope?: string,
): Promise<AuthCodeResult> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId) {
    throw new MailError('AUTH', 'Missing MICROSOFT_CLIENT_ID');
  }

  const authority = process.env.MICROSOFT_OAUTH_AUTHORITY || 'https://login.microsoftonline.com';
  const tenantSegment = tenant || process.env.MICROSOFT_TENANT_ID || 'common';
  const url = `${authority}/${tenantSegment}/oauth2/v2.0/token`;

  const build = (secret?: string) => {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    if (secret) params.append('client_secret', secret);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    if (scope) params.append('scope', scope);
    return params;
  };

  let result = await postForm(url, build(clientSecret));

  // Public-client app registrations reject a client_secret (AADSTS700025); retry without it.
  if (!result.ok && clientSecret) {
    const detail = result.body.error_description || result.raw;
    if (detail.includes('AADSTS700025')) {
      result = await postForm(url, build(undefined));
    }
  }

  if (!result.ok || !result.body.access_token) {
    throw new MailError('AUTH', `Microsoft code exchange failed: ${result.body.error_description || result.raw.slice(0, 200)}`);
  }

  return {
    accessToken: result.body.access_token,
    refreshToken: result.body.refresh_token,
    idToken: result.body.id_token,
    expiresAt: toExpiry(result.body.expires_in),
    scope: result.body.scope ?? scope,
  };
}

export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  input: { code: string; redirectUri: string; tenant?: string | null; scope?: string },
): Promise<AuthCodeResult> {
  if (provider === 'gmail') return exchangeGoogleCode(input.code, input.redirectUri);
  return exchangeMicrosoftCode(input.code, input.redirectUri, input.tenant ?? null, input.scope);
}
