// FILE: server/src/campaigns/trackingToken.ts
//
// HMAC-signed opaque tokens over a CampaignRecipient id, embedded in the
// public (unauthenticated) tracking pixel/redirect URLs. Signing prevents an
// outside party from enumerating recipient ids and forging OPENED/CLICKED
// events for someone else's campaign.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function secret(): string {
  if (config.TRACKING_SECRET) return config.TRACKING_SECRET;
  if (config.JWT_SECRET) return config.JWT_SECRET;
  if (config.NODE_ENV === 'production') {
    throw new Error('TRACKING_SECRET (or JWT_SECRET) is required in production');
  }
  return 'insecure-dev-tracking-secret';
}

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function sign(recipientId: string): string {
  return createHmac('sha256', secret()).update(recipientId).digest('base64url').slice(0, 22);
}

// ── Click-specific tokens (domain-separated) ──────────────────────────────────
// The HMAC input is: "c" NUL recipientId NUL target
// The "c\x00" prefix is the domain separator: a click token and a
// pixel/unsubscribe token (which hash only recipientId) can never collide.
// The NUL byte (0x00) between recipientId and target is unambiguous because
// neither a cuid nor a URL can contain a NUL byte, preventing length-extension
// confusion: (a, bc) and (ab, c) produce different inputs.

const CLICK_DOMAIN = Buffer.from('c\x00', 'utf8'); // "c" + NUL

function signClick(recipientId: string, target: string): string {
  const hmacInput = Buffer.concat([
    CLICK_DOMAIN,
    Buffer.from(recipientId, 'utf8'),
    Buffer.from('\x00', 'utf8'),
    Buffer.from(target, 'utf8'),
  ]);
  return createHmac('sha256', secret()).update(hmacInput).digest('base64url').slice(0, 22);
}

/**
 * Sign a click-tracking token that cryptographically binds recipientId to the
 * redirect target. The token shape is identical to signTrackingToken so the URL
 * format does not change, but the HMAC input includes both values plus a domain
 * separator, so swapping ?u= will invalidate the token.
 */
export function signClickToken(recipientId: string, target: string): string {
  return `${toBase64Url(recipientId)}.${signClick(recipientId, target)}`;
}

/**
 * Verify a click token against both the recipientId embedded in the token and
 * the target URL supplied in ?u=. Returns the recipientId on success, or null
 * on any malformed input or signature mismatch. Uses constant-time comparison
 * to resist timing attacks.
 */
export function verifyClickToken(token: string, target: string): string | null {
  if (!token || typeof token !== 'string') return null;
  if (!target || typeof target !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const idPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let recipientId: string;
  try {
    recipientId = fromBase64Url(idPart).toString('utf8');
  } catch {
    return null;
  }
  const expected = signClick(recipientId, target);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return recipientId;
}

// ── Address-scoped unsubscribe tokens ────────────────────────────────────────
// The HMAC input is: "a" NUL userId NUL email
//
// Why this exists: the two tokens above identify a CampaignRecipient row, which
// is how the campaign path builds its unsubscribe link. A one-off email — the
// Dashboard follow-up composer, a Unibox reply — has no such row, so those
// paths shipped with NO unsubscribe link and no postal address at all while the
// campaign path fails closed without them.
//
// Keyed on (tenant, address) rather than a stored id so it needs no table and
// no migration: the opt-out it produces is written to the Suppression list,
// which is already the record that survives a Lead being deleted.
//
// Domain-separated from the click ("c") and recipient (unprefixed) tokens, so a
// token minted for one purpose can never verify as another. The tenant is
// inside the MAC, so a token cannot be replayed to opt an address out of a
// different tenant's mail.

const ADDRESS_DOMAIN = Buffer.from('a\x00', 'utf8'); // "a" + NUL

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function signAddress(userId: string, email: string): string {
  const hmacInput = Buffer.concat([
    ADDRESS_DOMAIN,
    Buffer.from(userId, 'utf8'),
    Buffer.from('\x00', 'utf8'),
    Buffer.from(email, 'utf8'),
  ]);
  return createHmac('sha256', secret()).update(hmacInput).digest('base64url').slice(0, 22);
}

/** Mint an unsubscribe token for a (tenant, address) pair. */
export function signAddressUnsubscribeToken(userId: string, email: string): string {
  const normalized = normalizeEmail(email);
  return `${toBase64Url(`${userId}\x00${normalized}`)}.${signAddress(userId, normalized)}`;
}

/**
 * Verify an address-scoped token. Returns { userId, email } on success, else
 * null. Constant-time comparison, like the other two verifiers.
 */
export function verifyAddressUnsubscribeToken(token: string): { userId: string; email: string } | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  let payload: string;
  try {
    payload = fromBase64Url(token.slice(0, dot)).toString('utf8');
  } catch {
    return null;
  }

  const nul = payload.indexOf('\x00');
  if (nul <= 0) return null;
  const userId = payload.slice(0, nul);
  const email = payload.slice(nul + 1);
  if (!userId || !email) return null;

  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(signAddress(userId, email));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId, email };
}

// ── Original pixel/unsubscribe tokens (recipientId only) ─────────────────────

export function signTrackingToken(recipientId: string): string {
  return `${toBase64Url(recipientId)}.${sign(recipientId)}`;
}

/** Returns the recipientId if the token is well-formed and its signature verifies, else null. */
export function verifyTrackingToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const idPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let recipientId: string;
  try {
    recipientId = fromBase64Url(idPart).toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(recipientId);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return recipientId;
}
