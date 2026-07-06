import crypto from 'node:crypto';
import express, { Request, Response } from 'express';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { MailError } from '../httpErrors.js';
import { maskEmail } from '../util/redact.js';
import { exchangeAuthorizationCode, type OAuthProvider } from '../creds/oauth.js';
import { upsertMailbox } from '../creds/mailboxStore.js';
import { requireAuth, requireUserId } from './middleware.js';
import { signOAuthState, verifyOAuthState } from './jwt.js';

/**
 * Interactive OAuth2 consent flow for connecting a mailbox (Google Workspace /
 * Microsoft 365). Two legs:
 *
 *   GET /:provider/start     (requireAuth) — an authenticated UI call. Mints a
 *     signed `state` bound to req.auth.userId and returns the provider's
 *     authorize URL for the browser to navigate to.
 *
 *   GET /:provider/callback  (NO Authorization header — it is a top-level browser
 *     redirect from the provider). Protected instead by the signed `state`: it is
 *     the only thing that identifies + authorizes the tenant, and it can only be
 *     minted by an authenticated /start. The code is exchanged server-side with
 *     the backend client credentials and persisted via mailboxStore.upsertMailbox
 *     (which encrypts the tokens before they touch Postgres).
 *
 * Path: server/src/auth/oauthRoutes.ts
 */

const router = express.Router();

// Provider scopes. `openid email` is requested purely so the token response
// carries an id_token we can decode to learn *which* mailbox was connected;
// the mail scopes below are what IMAP/SMTP actually authenticate with.
const GOOGLE_SCOPES = ['https://mail.google.com/', 'openid', 'email'].join(' ');
const MICROSOFT_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

/** Normalize the :provider path segment to the canonical wire provider. */
function canonicalProvider(raw: string): OAuthProvider | null {
  const v = (raw || '').trim().toLowerCase();
  if (['gmail', 'google', 'workspace', 'googleworkspace', 'google_workspace'].includes(v)) return 'gmail';
  if (['microsoft', 'outlook', 'office365', 'o365', 'ms365', 'microsoft365'].includes(v)) return 'microsoft';
  return null;
}

function providerClientId(provider: OAuthProvider): string {
  const id = provider === 'gmail' ? process.env.GMAIL_OAUTH_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID;
  if (!id) {
    // Server misconfiguration, not a client error.
    throw new Error(`OAuth client id is not configured for ${provider}`);
  }
  return id;
}

/** Base URL of this backend (config override wins; else derive from the request). */
function backendBaseUrl(req: Request): string {
  if (config.OAUTH_REDIRECT_BASE_URL) return config.OAUTH_REDIRECT_BASE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * The redirect_uri. Built from a FIXED canonical path so it is byte-for-byte
 * identical in the /start authorize URL and the /callback exchange — providers
 * reject the exchange otherwise.
 */
function callbackUrl(req: Request, provider: OAuthProvider): string {
  return `${backendBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

function buildGoogleAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    // Force a refresh token even on re-consent (Google omits it otherwise).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function buildMicrosoftAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const authority = process.env.MICROSOFT_OAUTH_AUTHORITY || 'https://login.microsoftonline.com';
  const tenantSegment = process.env.MICROSOFT_TENANT_ID || 'common';
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    prompt: 'select_account',
    state: opts.state,
  });
  return `${authority}/${tenantSegment}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Decode (do not verify) the id_token payload; it arrived over a trusted TLS
 * channel directly from the provider's token endpoint. */
function decodeIdToken(idToken?: string): Record<string, unknown> | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function emailFromClaims(claims: Record<string, unknown> | null): string | null {
  if (!claims) return null;
  const candidate = claims.email ?? claims.preferred_username ?? claims.upn;
  return typeof candidate === 'string' && candidate.includes('@') ? candidate.toLowerCase() : null;
}

/** Redirect the browser back to the SPA with a small status query. */
function redirectToFrontend(res: Response, params: Record<string, string>): void {
  const url = new URL(config.WEB_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(url.toString());
}

function jsonError(res: Response, err: unknown): void {
  if (err instanceof MailError) {
    const status = err.code === 'AUTH' ? 401 : err.code === 'DENIED' ? 403 : 500;
    res.status(status).json({ code: err.code, message: err.message });
    return;
  }
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'OAuth start failed');
  res.status(500).json({ code: 'OAUTH', message: 'Could not start the OAuth connect flow' });
}

/**
 * GET /api/auth/oauth/:provider/start
 * Authenticated. Returns { authorizeUrl } for the frontend to navigate to.
 */
router.get('/:provider/start', requireAuth, (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const provider = canonicalProvider(req.params.provider);
    if (!provider) {
      res.status(400).json({ code: 'INVALID_PROVIDER', message: "provider must be 'gmail' or 'microsoft'" });
      return;
    }

    const clientId = providerClientId(provider);
    const redirectUri = callbackUrl(req, provider);
    const state = signOAuthState({ userId, provider, nonce: crypto.randomBytes(16).toString('hex') });

    const authorizeUrl =
      provider === 'gmail'
        ? buildGoogleAuthorizeUrl({ clientId, redirectUri, state })
        : buildMicrosoftAuthorizeUrl({ clientId, redirectUri, state });

    res.json({ authorizeUrl });
  } catch (err) {
    jsonError(res, err);
  }
});

/**
 * GET /api/auth/oauth/:provider/callback
 * The provider's redirect target. No Authorization header — the signed `state`
 * is the sole gate. On success the mailbox is upserted and the browser is bounced
 * back to the SPA with ?connected=<provider>; on any failure with ?oauth_error=.
 */
router.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = canonicalProvider(req.params.provider);

  // The provider surfaces user-denied consent / errors as query params.
  if (typeof req.query.error === 'string' && req.query.error) {
    const detail = typeof req.query.error_description === 'string' ? req.query.error_description : req.query.error;
    logger.warn({ provider, error: req.query.error }, 'OAuth provider returned an error');
    redirectToFrontend(res, { oauth_error: String(detail) });
    return;
  }

  try {
    if (!provider) throw new MailError('DENIED', 'Unknown OAuth provider');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code) throw new MailError('DENIED', 'Missing authorization code');
    if (!stateRaw) throw new MailError('DENIED', 'Missing OAuth state');

    // ── Anti-hijack gate: only a valid, unexpired, signed state proves this
    //    callback belongs to a user who actually started the flow. ────────────
    let state;
    try {
      state = verifyOAuthState(stateRaw);
    } catch {
      throw new MailError('DENIED', 'Invalid or expired OAuth state');
    }
    if (state.provider !== provider) {
      throw new MailError('DENIED', 'OAuth state does not match the callback provider');
    }
    const userId = state.sub;

    // Exchange the code with the backend client credentials.
    const redirectUri = callbackUrl(req, provider);
    const result = await exchangeAuthorizationCode(provider, {
      code,
      redirectUri,
      scope: provider === 'microsoft' ? MICROSOFT_SCOPES : undefined,
    });

    if (!result.refreshToken) {
      // Without a refresh token the mailbox can't be kept alive; force a clean re-consent.
      throw new MailError('AUTH', 'Provider did not return a refresh token; reconnect and grant offline access.');
    }

    const claims = decodeIdToken(result.idToken);
    const email = emailFromClaims(claims);
    if (!email) {
      throw new MailError('AUTH', 'Could not determine the mailbox email address from the provider response.');
    }
    // For Microsoft, persist the account's real home tenant so refreshes target it.
    const tenant = provider === 'microsoft' ? (typeof claims?.tid === 'string' ? claims.tid : null) : null;

    await upsertMailbox({
      userId,
      email,
      provider,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      scope: result.scope,
      tenant,
      expiresAt: result.expiresAt,
    });

    logger.info({ userId, provider, email: maskEmail(email) }, 'Connected mailbox via OAuth');
    redirectToFrontend(res, { connected: provider, email });
  } catch (err) {
    const message = err instanceof MailError ? err.message : 'OAuth connection failed';
    logger.error({ provider, err: err instanceof Error ? err.message : String(err) }, 'OAuth callback failed');
    redirectToFrontend(res, { oauth_error: message });
  }
});

export default router;
