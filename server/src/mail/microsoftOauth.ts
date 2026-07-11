import * as fs from 'node:fs/promises';
import path from 'node:path';

export type HttpError = Error & {
  status?: number;
  code?: string;
};

function makeHttpError(status: number, code: string, message: string): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  err.code = code;
  return err;
}

const MICROSOFT_IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All';
const MICROSOFT_SMTP_SCOPE = 'https://outlook.office.com/SMTP.Send';

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

type MicrosoftTokenRecord = {
  tenant: string;
  scope: string; // space-separated scope string used for refresh
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  obtainedAt: number; // epoch ms
  expiresAt: number; // epoch ms
};

type TokenStoreFile = {
  version: 1;
  microsoft: Record<string, MicrosoftTokenRecord>;
};

function normalizeUserKey(user: string): string {
  return user.trim().toLowerCase();
}

function resolveTokenStoragePath(): string {
  const raw = String(process.env.TOKEN_STORAGE_PATH ?? '').trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  return path.resolve(process.cwd(), 'data', 'tokens.json');
}

async function readStore(): Promise<TokenStoreFile> {
  const filePath = resolveTokenStoragePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TokenStoreFile>;
    return {
      version: 1,
      microsoft: (parsed && typeof parsed === 'object' && (parsed as any).microsoft) ? (parsed as any).microsoft : {},
    };
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { version: 1, microsoft: {} };
    }
    throw err;
  }
}

async function writeStore(store: TokenStoreFile): Promise<void> {
  const filePath = resolveTokenStoragePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const payload = JSON.stringify(store, null, 2);

  // Write to temp then rename to reduce corruption risk.
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2)}`;

  // Best-effort permissions; existing file permissions remain unchanged on overwrite/rename.
  await fs.writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });

  // Atomic-ish write:
  // - POSIX rename overwrites
  // - Windows rename can fail if destination exists
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err: any) {
    try {
      // Try delete+rename (common Windows workaround)
      await fs.unlink(filePath);
      await fs.rename(tmpPath, filePath);
    } catch {
      // Fall back to direct write (non-atomic but better than failing)
      await fs.writeFile(filePath, payload, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore
      }
    }
  }
}

export async function hasMicrosoftTokens(user: string): Promise<boolean> {
  const store = await readStore();
  return !!store.microsoft[normalizeUserKey(user)];
}

export async function clearMicrosoftTokens(user: string): Promise<void> {
  const key = normalizeUserKey(user);
  const store = await readStore();
  if (store.microsoft[key]) {
    delete store.microsoft[key];
    await writeStore(store);
  }
}

function resolveTenant(tenantId?: string): string {
  const fromReq = typeof tenantId === 'string' ? tenantId.trim() : '';
  const fromEnv = String(process.env.MICROSOFT_TENANT_ID ?? '').trim();
  return fromReq || fromEnv || 'common';
}

function resolveAuthorityBase(tenant: string): string {
  const raw = String(process.env.MICROSOFT_OAUTH_AUTHORITY ?? '').trim();
  if (!raw) return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;

  // Support template like https://login.microsoftonline.com/{tenant}
  if (raw.includes('{tenant}')) return raw.replace('{tenant}', encodeURIComponent(tenant)).replace(/\/+$/, '');

  const trimmed = raw.replace(/\/+$/, '');
  // If the authority already includes a tenant segment, keep it; otherwise append.
  const looksLikeAuthorityWithTenant = /login\.microsoftonline\.com\/[^/]+$/i.test(trimmed);
  return looksLikeAuthorityWithTenant ? trimmed : `${trimmed}/${encodeURIComponent(tenant)}`;
}

function requiredMicrosoftClientId(): string {
  const clientId = String(process.env.MICROSOFT_CLIENT_ID ?? '').trim();
  if (!clientId) {
    throw makeHttpError(500, 'AUTH', 'Missing MICROSOFT_CLIENT_ID in server .env (required for Microsoft IMAP OAuth2).');
  }
  return clientId;
}

function optionalMicrosoftClientSecret(): string | undefined {
  const s = String(process.env.MICROSOFT_CLIENT_SECRET ?? '').trim();
  return s || undefined;
}

function buildScopes(includeSmtpSend?: boolean): string[] {
  const scopes = ['offline_access', 'openid', 'profile', MICROSOFT_IMAP_SCOPE];
  if (includeSmtpSend) scopes.push(MICROSOFT_SMTP_SCOPE);
  return scopes;
}

async function postForm(url: string, form: Record<string, string>): Promise<{
  ok: boolean;
  status: number;
  json: any;
}> {
  const body = new URLSearchParams(form);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await resp.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }

  return { ok: resp.ok, status: resp.status, json };
}

function decodeJwtPayload(idToken: string): Record<string, any> | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return null;
  }
}

export type MicrosoftDeviceCodeStartResult = {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
  tenant: string;
  scopes: string[];
};

export async function startMicrosoftDeviceCodeFlow(input?: {
  tenantId?: string;
  includeSmtpSend?: boolean;
}): Promise<MicrosoftDeviceCodeStartResult> {
  const tenant = resolveTenant(input?.tenantId);
  const scopes = buildScopes(input?.includeSmtpSend);
  const clientId = requiredMicrosoftClientId();

  const authority = resolveAuthorityBase(tenant);
  const deviceCodeEndpoint = `${authority}/oauth2/v2.0/devicecode`;

  const { ok, status, json } = await postForm(deviceCodeEndpoint, {
    client_id: clientId,
    scope: scopes.join(' '),
  });

  if (!ok) {
    const msg =
      (json && (json.error_description || json.error)) ||
      `Failed to start device code flow (HTTP ${status}).`;
    throw makeHttpError(400, 'AUTH', msg);
  }

  // Expected fields: device_code, user_code, verification_uri, expires_in, interval, message
  if (!json?.device_code || !json?.user_code || !json?.verification_uri) {
    throw makeHttpError(500, 'AUTH', 'Microsoft device code endpoint returned an unexpected response.');
  }

  return {
    user_code: String(json.user_code),
    device_code: String(json.device_code),
    verification_uri: String(json.verification_uri),
    expires_in: Number(json.expires_in ?? 0),
    interval: Number(json.interval ?? 5),
    message: String(json.message ?? ''),
    tenant,
    scopes,
  };
}

export type MicrosoftDeviceCodePollResult =
  | {
      status: 'authorized';
      mailboxUser: string;
      tenant: string;
      expiresAt: number;
    }
  | {
      status: 'pending' | 'slow_down';
      error: string;
      message: string;
      interval: number;
    };

async function saveMicrosoftToken(user: string, record: MicrosoftTokenRecord): Promise<void> {
  const key = normalizeUserKey(user);
  const store = await readStore();
  store.microsoft[key] = record;
  await writeStore(store);
}

async function loadMicrosoftToken(user: string): Promise<MicrosoftTokenRecord | null> {
  const key = normalizeUserKey(user);
  const store = await readStore();
  return store.microsoft[key] ?? null;
}

export async function pollMicrosoftDeviceCodeFlow(input: {
  deviceCode: string;
  tenantId?: string;
  includeSmtpSend?: boolean;
}): Promise<MicrosoftDeviceCodePollResult> {
  const deviceCode = String(input.deviceCode ?? '').trim();
  if (!deviceCode) {
    throw makeHttpError(400, 'VALIDATION', 'device_code is required.');
  }

  const tenant = resolveTenant(input.tenantId);
  const scopes = buildScopes(input.includeSmtpSend);
  const clientId = requiredMicrosoftClientId();

  const authority = resolveAuthorityBase(tenant);
  const tokenEndpoint = `${authority}/oauth2/v2.0/token`;

  const { ok, status, json } = await postForm(tokenEndpoint, {
    client_id: clientId,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
  });

  if (!ok) {
    const errCode = String(json?.error ?? '');
    const errDesc = String(json?.error_description ?? '');

    if (errCode === 'authorization_pending') {
      return {
        status: 'pending',
        error: errCode,
        message: errDesc || 'Authorization pending. Complete the device code step and keep polling.',
        interval: Number(json?.interval ?? 5),
      };
    }

    if (errCode === 'slow_down') {
      return {
        status: 'slow_down',
        error: errCode,
        message: errDesc || 'Poll too frequently. Slow down.',
        interval: Number(json?.interval ?? 5) + 5,
      };
    }

    if (errCode === 'expired_token') {
      throw makeHttpError(400, 'AUTH', 'Device code expired. Start the device code flow again.');
    }
    if (errCode === 'authorization_declined') {
      throw makeHttpError(400, 'AUTH', 'Authorization was declined.');
    }
    if (errCode === 'bad_verification_code') {
      throw makeHttpError(400, 'AUTH', 'Bad verification code/device code.');
    }

    const msg = errDesc || errCode || `Device code poll failed (HTTP ${status}).`;
    throw makeHttpError(400, 'AUTH', msg);
  }

  const accessToken = String(json?.access_token ?? '');
  const refreshToken = String(json?.refresh_token ?? '');
  const tokenType = String(json?.token_type ?? 'Bearer');
  const expiresInSec = Number(json?.expires_in ?? 0);
  const scopeStr = String(json?.scope ?? scopes.join(' '));

  if (!accessToken || !expiresInSec) {
    throw makeHttpError(500, 'AUTH', 'Microsoft token endpoint returned an unexpected response (missing access_token).');
  }
  if (!refreshToken) {
    throw makeHttpError(
      500,
      'AUTH',
      'Microsoft token endpoint did not return a refresh_token. Ensure scope includes offline_access and the app allows public client flows.'
    );
  }

  // Enforce that this authorization is for the configured mailbox user (to avoid storing the wrong account).
  const expectedUser = String(process.env.MICROSOFT_USER ?? '').trim();
  if (!expectedUser) {
    throw makeHttpError(500, 'AUTH', 'Missing MICROSOFT_USER in server .env (needed to bind stored tokens to a mailbox).');
  }

  const idToken = typeof json?.id_token === 'string' ? String(json.id_token) : '';
  const claims = idToken ? decodeJwtPayload(idToken) : null;
  const tokenUser =
    (claims && (claims.preferred_username || claims.upn || claims.email || claims.unique_name)) ? String(
      claims.preferred_username || claims.upn || claims.email || claims.unique_name
    ) : '';

  if (tokenUser && normalizeUserKey(tokenUser) !== normalizeUserKey(expectedUser)) {
    throw makeHttpError(
      400,
      'AUTH',
      `Authorization completed for '${tokenUser}', but server is configured for '${expectedUser}'. Please authenticate the configured mailbox user.`
    );
  }

  const obtainedAt = Date.now();
  const expiresAt = obtainedAt + expiresInSec * 1000;

  await saveMicrosoftToken(expectedUser, {
    tenant,
    scope: scopeStr,
    tokenType,
    accessToken,
    refreshToken,
    obtainedAt,
    expiresAt,
  });

  return {
    status: 'authorized',
    mailboxUser: expectedUser,
    tenant,
    expiresAt,
  };
}

async function refreshMicrosoftToken(user: string, record: MicrosoftTokenRecord): Promise<MicrosoftTokenRecord> {
  const clientId = requiredMicrosoftClientId();
  const clientSecret = optionalMicrosoftClientSecret();

  const authority = resolveAuthorityBase(record.tenant);
  const tokenEndpoint = `${authority}/oauth2/v2.0/token`;

  const form: Record<string, string> = {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: record.refreshToken,
    scope: record.scope,
  };

  if (clientSecret) form.client_secret = clientSecret;

  const { ok, status, json } = await postForm(tokenEndpoint, form);

  if (!ok) {
    const errCode = String(json?.error ?? '');
    const errDesc = String(json?.error_description ?? '');

    // Most common long-term failure: invalid_grant (revoked/expired refresh token)
    if (errCode === 'invalid_grant') {
      await clearMicrosoftTokens(user).catch(() => {});
      throw makeHttpError(
        401,
        'AUTH',
        `Microsoft refresh token is no longer valid (invalid_grant). Re-run the device code flow to reconnect. ${errDesc}`
      );
    }

    throw makeHttpError(502, 'AUTH', errDesc || errCode || `Token refresh failed (HTTP ${status}).`);
  }

  const accessToken = String(json?.access_token ?? '');
  const refreshToken = String(json?.refresh_token ?? '') || record.refreshToken;
  const tokenType = String(json?.token_type ?? record.tokenType ?? 'Bearer');
  const expiresInSec = Number(json?.expires_in ?? 0);
  const scopeStr = String(json?.scope ?? record.scope);

  if (!accessToken || !expiresInSec) {
    throw makeHttpError(502, 'AUTH', 'Token refresh succeeded but returned an invalid response (missing access_token).');
  }

  const obtainedAt = Date.now();
  const expiresAt = obtainedAt + expiresInSec * 1000;

  return {
    tenant: record.tenant,
    scope: scopeStr,
    tokenType,
    accessToken,
    refreshToken,
    obtainedAt,
    expiresAt,
  };
}

export async function getMicrosoftImapAccessToken(user: string): Promise<string> {
  const record = await loadMicrosoftToken(user);
  if (!record) {
    throw makeHttpError(
      401,
      'AUTH',
      'Microsoft IMAP OAuth is not connected. Run POST /api/mail/oauth/microsoft/device-code/start then poll /api/mail/oauth/microsoft/device-code/poll to store tokens.'
    );
  }

  const now = Date.now();
  const expiring = !record.expiresAt || now + TOKEN_REFRESH_SKEW_MS >= record.expiresAt;

  if (!expiring && record.accessToken) return record.accessToken;

  const refreshed = await refreshMicrosoftToken(user, record);
  await saveMicrosoftToken(user, refreshed);
  return refreshed.accessToken;
}
