import { randomUUID } from 'node:crypto';

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
  /**
   * Per-issue uniqueness.
   *
   * Without it, two refresh tokens minted for the same user in the same SECOND
   * are byte-identical (the payload is just sub/email/ver/typ plus iat/exp at
   * one-second resolution). Rotation then "issues" the token it just retired:
   * the server-side record collides on its unique tokenHash, and the retired
   * token starts working again. Caught by asserting the rotated token actually
   * differs, not merely that the response was 200.
   */
  jti: string;
}

/**
 * Short-lived, signed CSRF/identity token carried through the OAuth consent
 * round-trip as the `state` parameter. The OAuth callback is a top-level browser
 * redirect from the provider and therefore has NO Authorization header.
 *
 * ⚠️ A signature alone is NOT sufficient here, and reasoning only about
 * forgery is the trap this comment used to set. "An attacker cannot forge a
 * state" is true but answers the wrong question. The dangerous direction is the
 * reverse: an attacker calls /start on their OWN account, obtains a perfectly
 * valid state, and phishes a victim with that authorize URL. The victim
 * consents with their own mailbox, and the callback — seeing a valid signature
 * and the attacker's `sub` — attaches THE VICTIM'S mailbox tokens to the
 * ATTACKER'S tenant.
 *
 * The defence is binding the state to the *browser*, not just to a userId:
 * `bnd` is the SHA-256 of a random secret that /start also drops in an
 * HttpOnly cookie. The callback requires the cookie to be present and to hash
 * to `bnd`, then clears it. That makes the state both browser-bound (the
 * attacker's cookie is not in the victim's browser) and genuinely single-use.
 *
 * This replaces an earlier `nonce` field that was minted, signed, and then
 * never stored or compared anywhere — it documented replay protection that did
 * not exist.
 */
export interface OAuthStateClaims {
  sub: string; // userId that initiated the connect flow
  provider: 'gmail' | 'microsoft';
  bnd: string; // sha256(binding secret) — must match the /start cookie
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
    jti: randomUUID(),
  };
  return jwt.sign(claims, getSecret(), signOptions(config.JWT_REFRESH_TTL));
}

// CRM tokens carry no `aud`; client-portal tokens carry aud:'client'. jwt.verify
// only validates `aud` when asked to, so an explicit rejection is required here —
// otherwise a portal token (also typ:'access') would authorize CRM routes.
function assertNoAudience(decoded: jwt.JwtPayload): void {
  if (decoded.aud !== undefined) {
    throw new Error('Audience-scoped token is not valid for CRM routes');
  }
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'access') {
    throw new Error('Not an access token');
  }
  assertNoAudience(decoded as jwt.JwtPayload);
  return decoded as unknown as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'refresh') {
    throw new Error('Not a refresh token');
  }
  assertNoAudience(decoded as jwt.JwtPayload);
  return decoded as unknown as RefreshTokenClaims;
}

// The consent round-trip is expected to complete in seconds; keep the state
// valid just long enough to survive the provider's login/consent screens.
const OAUTH_STATE_TTL = '10m';

export function signOAuthState(input: {
  userId: string;
  provider: 'gmail' | 'microsoft';
  bnd: string;
}): string {
  const claims: OAuthStateClaims = {
    sub: input.userId,
    provider: input.provider,
    bnd: input.bnd,
    typ: 'oauth_state',
  };
  return jwt.sign(claims, getSecret(), signOptions(OAUTH_STATE_TTL));
}

export function verifyOAuthState(token: string): OAuthStateClaims {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === 'string' || (decoded as jwt.JwtPayload).typ !== 'oauth_state') {
    throw new Error('Not an oauth state token');
  }
  const claims = decoded as unknown as OAuthStateClaims;
  // A state minted before browser binding existed carries no `bnd`. Reject it
  // rather than treating a missing binding as "nothing to check" — that would
  // reopen the hole for anyone able to present an old token.
  if (typeof claims.bnd !== 'string' || claims.bnd.length === 0) {
    throw new Error('OAuth state is missing its browser binding');
  }
  return claims;
}
