// FILE: server/src/leads/suppression.ts
//
// Per-tenant permanent do-not-contact list, keyed on a hash of the address.
//
// Why this exists separately from Lead.status = DNC: the DNC status lives on a
// row that can be deleted. `DELETE /api/leads/:id` hard-deletes the Lead, and
// an erasure request must delete it — so the opt-out disappeared with the
// person's record, and re-importing the same CSV would happily contact them
// again. Suppression is the one piece of state that has to outlive the data it
// protects.
//
// Why only a hash: it makes "erase everything you hold about me" and "never
// contact me again" compatible instead of contradictory. After an erasure we
// retain no address, no name, no history — but a future import of the same
// address hashes to the same key and is dropped before it is ever stored.

import { createHash } from 'node:crypto';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

export type SuppressionReason = 'UNSUBSCRIBE' | 'DNC' | 'ERASURE' | 'HARD_BOUNCE';

/**
 * Canonical lookup key: sha256 of the lowercased, trimmed address.
 *
 * Case and surrounding whitespace are normalised because they are not part of
 * the identity of a mailbox for any provider we send through, and an opt-out
 * that " Bob@Example.com " defeats is not an opt-out. Beyond that we do NOT
 * normalise (no Gmail dot-stripping, no plus-tag removal): guessing that two
 * addresses are "really" the same risks suppressing someone who never asked,
 * which is its own kind of wrong.
 */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/**
 * Record an opt-out. Idempotent — re-unsubscribing is not an error, and the
 * first reason recorded is kept (the earliest opt-out is the operative one).
 */
export async function suppress(
  userId: string,
  email: string,
  reason: SuppressionReason,
): Promise<void> {
  const hash = emailHash(email);
  try {
    await prisma.suppression.upsert({
      where: { userId_emailHash: { userId, emailHash: hash } },
      update: {},
      create: { userId, emailHash: hash, reason },
    });
  } catch (err) {
    // Never let a suppression write fail the caller outright — but DO shout
    // about it, because a lost suppression is how someone gets emailed after
    // opting out. Callers on the send path check isSuppressed() separately.
    logger.error({ err, userId, reason }, 'Failed to record suppression');
    throw err;
  }
}

/** True when this tenant must not contact this address. */
export async function isSuppressed(userId: string, email: string): Promise<boolean> {
  const found = await prisma.suppression.findUnique({
    where: { userId_emailHash: { userId, emailHash: emailHash(email) } },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Partition a batch of addresses into allowed / suppressed, in ONE query.
 *
 * Used by lead import, where the per-address `isSuppressed` would mean one
 * round trip per row of a CSV. Returns the suppressed addresses in their
 * original form so the caller can report which rows it dropped.
 */
export async function partitionSuppressed(
  userId: string,
  emails: string[],
): Promise<{ allowed: string[]; suppressed: string[] }> {
  if (emails.length === 0) return { allowed: [], suppressed: [] };

  const byHash = new Map<string, string>();
  for (const email of emails) byHash.set(emailHash(email), email);

  const hits = await prisma.suppression.findMany({
    where: { userId, emailHash: { in: [...byHash.keys()] } },
    select: { emailHash: true },
  });

  const blocked = new Set(hits.map((h) => h.emailHash));
  const allowed: string[] = [];
  const suppressed: string[] = [];
  for (const [hash, email] of byHash) {
    (blocked.has(hash) ? suppressed : allowed).push(email);
  }
  return { allowed, suppressed };
}
