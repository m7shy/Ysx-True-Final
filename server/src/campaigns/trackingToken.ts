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
