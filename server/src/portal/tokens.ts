import crypto from 'node:crypto';
import type { ClientTokenKind } from '@prisma/client';
import { prisma } from '../db/prisma.js';

/**
 * Single-use portal login tokens (invite / magic link). Only the SHA-256 hash
 * ever touches the database, so a DB leak never yields a working login link.
 */

const TTL_MS: Record<ClientTokenKind, number> = {
  INVITE: 7 * 24 * 60 * 60 * 1000, // 7 days — client may not check email today
  MAGIC_LINK: 15 * 60 * 1000, // 15 minutes — issued on demand, used immediately
};

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Mint a token row and return the RAW token (embed in the emailed link only). */
export async function createLoginToken(clientUserId: string, kind: ClientTokenKind): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.clientLoginToken.create({
    data: {
      clientUserId,
      kind,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TTL_MS[kind]),
    },
  });
  return raw;
}

/**
 * True when an unexpired, unused MAGIC_LINK token already exists for this
 * ClientUser.  Called by the magic-link handler to avoid minting (and sending)
 * a duplicate token before the previous one has had a chance to be used,
 * which would otherwise let a single IP exhaust the tenant's email quota.
 */
export async function hasUnexpiredMagicLink(clientUserId: string): Promise<boolean> {
  const existing = await prisma.clientLoginToken.findFirst({
    where: {
      clientUserId,
      kind: 'MAGIC_LINK',
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Atomically consume a token: valid kind + unexpired + unused, marked used in
 * the same conditional update so two concurrent consumes can never both win.
 * Returns the owning ClientUser (with client) or null if invalid.
 */
export async function consumeLoginToken(raw: string, kind: ClientTokenKind) {
  const tokenHash = hashToken(raw);
  const now = new Date();

  const claimed = await prisma.clientLoginToken.updateMany({
    where: { tokenHash, kind, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;

  const row = await prisma.clientLoginToken.findUnique({
    where: { tokenHash },
    include: { clientUser: { include: { client: true } } },
  });
  return row?.clientUser ?? null;
}
