import type { Response, CookieOptions } from 'express';
import { config } from '../config.js';

/**
 * Shared refresh-token cookie helpers for the CRM and client-portal auth flows.
 *
 * Two separate cookie names (CRM_REFRESH_COOKIE / PORTAL_REFRESH_COOKIE) let a
 * CRM admin session and a client-portal session coexist in the same browser,
 * exactly as the two localStorage keys did before this migration.
 *
 * Cookie flags:
 *   HttpOnly — prevents script access (the whole point of this migration).
 *   SameSite=Lax — allows the cookie to ride on same-site navigations but blocks
 *     cross-origin POST (adequate for refresh which is always a same-origin XHR).
 *   Secure — set in production only (local dev runs over plain HTTP).
 *   Path — scoped to the respective refresh endpoint so the cookie is never sent
 *     on other requests (smaller attack surface, smaller headers).
 *   Max-Age — matches the JWT_REFRESH_TTL from config.
 */

export const CRM_REFRESH_COOKIE = 'ysxflow_rt';
export const PORTAL_REFRESH_COOKIE = 'ysxportal_rt';

/** Convert a human-readable TTL string like '30d' into seconds for Max-Age. */
function ttlToSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return 30 * 24 * 60 * 60; // safe fallback: 30 days
  const n = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 60 * 60;
    case 'd': return n * 24 * 60 * 60;
    default: return 30 * 24 * 60 * 60;
  }
}

function cookieOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path,
    maxAge: ttlToSeconds(config.JWT_REFRESH_TTL) * 1000, // Express wants milliseconds
  };
}

/**
 * Options for CLEARING a cookie: identical to the set options except that
 * maxAge/expires must be omitted.
 *
 * res.clearCookie() applies whatever options it is given, so passing the same
 * object used to set the cookie re-sends maxAge and the browser stores an empty
 * value for another 30 days instead of deleting the cookie. Observed on the
 * live response after deploy:
 *   Set-Cookie: ysxflow_rt=; Max-Age=2592000; Expires=<30 days ahead>
 * The session still ended — the token value is destroyed, which is the
 * security-relevant part — but the cookie lingered rather than being removed.
 */
function clearOptions(path: string): CookieOptions {
  const { maxAge: _maxAge, ...rest } = cookieOptions(path);
  return rest;
}

// ── CRM helpers ───────────────────────────────────────────────────────────────

const CRM_REFRESH_PATH = '/api/auth/refresh';

export function setCrmRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(CRM_REFRESH_COOKIE, refreshToken, cookieOptions(CRM_REFRESH_PATH));
}

export function clearCrmRefreshCookie(res: Response): void {
  res.clearCookie(CRM_REFRESH_COOKIE, clearOptions(CRM_REFRESH_PATH));
}

// ── Portal helpers ────────────────────────────────────────────────────────────

const PORTAL_REFRESH_PATH = '/api/portal/auth/refresh';

export function setPortalRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(PORTAL_REFRESH_COOKIE, refreshToken, cookieOptions(PORTAL_REFRESH_PATH));
}

export function clearPortalRefreshCookie(res: Response): void {
  res.clearCookie(PORTAL_REFRESH_COOKIE, clearOptions(PORTAL_REFRESH_PATH));
}

// ── OAuth state binding ───────────────────────────────────────────────────────
// Ties an in-flight OAuth consent round-trip to the browser that started it.
// /start stores a random secret here and puts its SHA-256 in the signed state;
// /callback requires both to match, then clears this cookie so the state cannot
// be replayed. Without this, a valid state is a bearer token: an attacker can
// phish a victim with their own authorize URL and capture the victim's mailbox
// into the attacker's tenant (see jwt.ts OAuthStateClaims).
//
// SameSite MUST stay 'lax', not 'strict': the callback is a top-level GET
// navigation from the provider's domain, and Lax is what allows the cookie to
// ride along with it. 'strict' would drop the cookie and break every connect.

export const OAUTH_STATE_COOKIE = 'ysx_oauth_state';
const OAUTH_STATE_PATH = '/api/auth/oauth';
// Matches OAUTH_STATE_TTL in jwt.ts — the consent round-trip is seconds, and a
// short window limits how long a captured cookie is worth anything.
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function oauthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: OAUTH_STATE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  };
}

export function setOAuthStateCookie(res: Response, secret: string): void {
  res.cookie(OAUTH_STATE_COOKIE, secret, oauthStateCookieOptions());
}

export function clearOAuthStateCookie(res: Response): void {
  const { maxAge: _maxAge, ...rest } = oauthStateCookieOptions();
  res.clearCookie(OAUTH_STATE_COOKIE, rest);
}
