import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * JWT issuance/verification for the multi-tenant gateway.
 *
 * Two token types share one signing secret but are distinguished by `typ`:
 *   - access  (short-lived, 15m): authorizes API calls. Carries sub + email.
 *   - refresh (long-lived, 30d): mints new access tokens. Also carries `ver`,
 *     the User.tokenVersion at issue time. Bumping User.tokenVersion (password
 *     reset / logout-everywhere) invalidates every outstanding refresh token.
 */

export interface AccessTokenClaims {
  sub: string; // userId
  email: string;
  ver?: number; // User.tokenVersion snapshot at issue (optional: old tokens predate this claim)
  typ: 'access';
}

export interface RefreshTokenClaims {
  sub: string; // userId
  email: string;
  ver: number; // User.tokenVersion snapshot
  typ: 'refresh';
}

/**
 * Short-lived, signed CSRF/identity token carried through the OAuth consent
 * round-trip as the `state` parameter. The OAuth callback is a top-level browser
 * redirect from the provider and therefore has NO Authorization header — this
 * signed state is what binds the callback to the user who started the flow.
 * Because only an authenticated `/start` call can mint one, an attacker cannot
 * forge a state to graft their own mailbox onto a victim's account.
 */
export interface OAuthStateClaims {
  sub: string; // userId that initiated the connect flow
  provider: 'gmail' | 'microsoft';
  nonce: string; // per-request random value (defense-in-depth against replay)
  typ: 'oauth_state';
}

// Stable, obviously-non-production secret used only for dev/test so tokens
// remain valid across reloads without forcing every developer to set JWT_SECRET.
const DEV_FALLBACK_SECRET = 'dev-insecure-jwt-secret-do-not-use-in-production';
let warnedDevSecret = false;

function getSecret(): string {
  if (config.JWT_SECRET) return config.JWT_SECRET;

  if (config.NODE_ENV === 'production') {
    // Defense in depth; config.ts already throws at boot in production.
    throw new Error('JWT_SECRET is required in production');
  }

  if (!warnedDevSecret) {
    logger.warn('JWT_SECRET not set — using an insecure dev fallback secret.');
    warnedDevSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

function signOptions(expiresIn: string): jwt.SignOptions {
  return { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
}

export function signAccessToken(input: { userId: string; email: string; tokenVersion?: number }): string {
  const claims: AccessTokenClaims = {
    sub: input.userId,
    email: input.email,
    ...(input.tokenVersion !== undefined ? { ver: input.tokenVersion } : {}),
    typ: 'access',
  };
  return jwt.sign(claims, getSecret(), signOptions(config.JWT_ACCESS_TTL));
}

export function signRefreshToken(input: {
  userId: string;
  email: string;
  tokenVersion: number;
}): string {
  const claims: RefreshTokenClaims = {
    sub: input.userId,
    email: input.email,
    ver: input.tokenVersion,
    typ: 'refresh',
  };
  return jwt.sign(claims, getSecret(), signOptions(config.JWT_REFRESH_TTL));
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'access') {
    throw new Error('Not an access token');
  }
  return decoded as unknown as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'refresh') {
    throw new Error('Not a refresh token');
  }
  return decoded as unknown as RefreshTokenClaims;
}

// The consent round-trip is expected to complete in seconds; keep the state
// valid just long enough to survive the provider's login/consent screens.
const OAUTH_STATE_TTL = '10m';

export function signOAuthState(input: {
  userId: string;
  provider: 'gmail' | 'microsoft';
  nonce: string;
}): string {
  const claims: OAuthStateClaims = {
    sub: input.userId,
    provider: input.provider,
    nonce: input.nonce,
    typ: 'oauth_state',
  };
  return jwt.sign(claims, getSecret(), signOptions(OAUTH_STATE_TTL));
}

export function verifyOAuthState(token: string): OAuthStateClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'oauth_state') {
    throw new Error('Not an oauth state token');
  }
  return decoded as unknown as OAuthStateClaims;
}
