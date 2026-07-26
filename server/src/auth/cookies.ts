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

// ── CRM helpers ───────────────────────────────────────────────────────────────

const CRM_REFRESH_PATH = '/api/auth/refresh';

export function setCrmRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(CRM_REFRESH_COOKIE, refreshToken, cookieOptions(CRM_REFRESH_PATH));
}

export function clearCrmRefreshCookie(res: Response): void {
  res.clearCookie(CRM_REFRESH_COOKIE, cookieOptions(CRM_REFRESH_PATH));
}

// ── Portal helpers ────────────────────────────────────────────────────────────

const PORTAL_REFRESH_PATH = '/api/portal/auth/refresh';

export function setPortalRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(PORTAL_REFRESH_COOKIE, refreshToken, cookieOptions(PORTAL_REFRESH_PATH));
}

export function clearPortalRefreshCookie(res: Response): void {
  res.clearCookie(PORTAL_REFRESH_COOKIE, cookieOptions(PORTAL_REFRESH_PATH));
}
