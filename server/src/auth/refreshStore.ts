// FILE: server/src/auth/refreshStore.ts
//
// Refresh-token rotation with reuse detection, shared by the CRM and the
// client portal. See the RefreshToken model comment in schema.prisma for the
// why; this file is the mechanism.

import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

/** Which principal a session belongs to. Exactly one is ever set. */
export type RefreshSubject = { userId: string } | { clientUserId: string };

function subjectWhere(subject: RefreshSubject) {
  return 'userId' in subject ? { userId: subject.userId } : { clientUserId: subject.clientUserId };
}

/**
 * The token is the secret; only its digest is stored.
 *
 * Plain sha256, not a password hash: this value is a 200+ character
 * high-entropy JWT, not a human-chosen password, so there is nothing for a
 * brute-force to guess and the cost of bcrypt/argon on every refresh buys
 * nothing. The property that matters is that the table is useless if leaked.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Expiry taken from the token's OWN `exp` claim rather than re-deriving it from
 * config, so the row and the JWT can never disagree about when the session
 * ends — including after JWT_REFRESH_TTL is changed.
 */
function expiryOf(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) return new Date(decoded.exp * 1000);
  // A refresh token without exp should be impossible; treat it as immediately
  // stale rather than granting an unbounded session.
  logger.warn('Refresh token carries no exp claim; recording it as already expired');
  return new Date(0);
}

/**
 * Concurrent-refresh grace window.
 *
 * Two browser tabs booting at once both run the silent refresh with the same
 * cookie. Without this, the second one is indistinguishable from a replay and
 * would revoke the family — logging the user out for opening a second tab.
 *
 * So a second use INSIDE the window is treated as the same client racing
 * itself: no revocation, and a fresh successor is issued in the same family.
 * Outside the window it is treated as theft. The cost is a narrow window in
 * which a stolen token can still be redeemed; the alternative is either no
 * rotation at all, or a login flow that breaks on ordinary tab use. Ten seconds
 * is far shorter than the 30-day exposure this replaces.
 */
const REUSE_GRACE_MS = 10_000;

export type RotateResult =
  | { status: 'ok'; familyId: string }
  | { status: 'invalid' }
  | { status: 'reused'; familyId: string };

/**
 * Record a freshly-minted refresh token.
 *
 * `familyId` continues an existing session chain; omit it to start a new one
 * (i.e. at login).
 */
export async function recordRefreshToken(
  subject: RefreshSubject,
  token: string,
  familyId?: string,
): Promise<string> {
  const family = familyId ?? randomUUID();
  await prisma.refreshToken.create({
    data: {
      ...subjectWhere(subject),
      familyId: family,
      tokenHash: hashToken(token),
      expiresAt: expiryOf(token),
    },
  });
  return family;
}

/**
 * Consume a presented refresh token.
 *
 * Returns:
 *  - `ok`      — the token was valid and unused; the caller may mint a
 *                successor with the returned familyId.
 *  - `reused`  — it had already been consumed outside the grace window. The
 *                family is revoked before returning; the caller must reject.
 *  - `invalid` — unknown, revoked or expired. The caller must reject.
 *
 * The consume is a conditional updateMany (`usedAt: null` in the WHERE), not a
 * read-then-write. Two simultaneous refreshes would otherwise both read
 * `usedAt: null`, both believe they won, and both mint successors — silently
 * forking the family and defeating the detection entirely.
 */
export async function consumeRefreshToken(token: string): Promise<RotateResult> {
  const tokenHash = hashToken(token);

  const claimed = await prisma.refreshToken.updateMany({
    where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claimed.count === 1) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash }, select: { familyId: true } });
    // The row cannot vanish between the two statements in practice; if it
    // somehow does, fail closed rather than inventing a family.
    return row ? { status: 'ok', familyId: row.familyId } : { status: 'invalid' };
  }

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { familyId: true, usedAt: true, revokedAt: true, expiresAt: true, userId: true, clientUserId: true },
  });

  // Unknown token. This is also every pre-rotation stateless session, which is
  // why the deploy logs everyone out once.
  if (!existing) return { status: 'invalid' };
  if (existing.revokedAt) return { status: 'invalid' };
  if (existing.expiresAt.getTime() <= Date.now()) return { status: 'invalid' };

  if (existing.usedAt) {
    const age = Date.now() - existing.usedAt.getTime();
    if (age <= REUSE_GRACE_MS) {
      // Same client, two tabs. Not a theft.
      logger.info({ familyId: existing.familyId }, 'Concurrent refresh within grace window; issuing a successor');
      return { status: 'ok', familyId: existing.familyId };
    }

    logger.warn(
      {
        familyId: existing.familyId,
        userId: existing.userId ?? undefined,
        clientUserId: existing.clientUserId ?? undefined,
        reusedAfterMs: age,
      },
      'Refresh-token REUSE detected — revoking the whole session family',
    );
    await revokeFamily(existing.familyId);
    return { status: 'reused', familyId: existing.familyId };
  }

  return { status: 'invalid' };
}

/** Revoke every token in one session chain (logout, or reuse detection). */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every session a principal has (logout-everywhere, password change). */
export async function revokeAllForSubject(subject: RefreshSubject): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { ...subjectWhere(subject), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke the family a specific token belongs to, if it is known. Never throws. */
export async function revokeFamilyForToken(token: string): Promise<void> {
  try {
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { familyId: true },
    });
    if (row) await revokeFamily(row.familyId);
  } catch (err) {
    // Logout must clear the cookie and return 200 regardless — a failure here
    // must not leave the user apparently signed in.
    logger.error({ err }, 'Failed to revoke refresh-token family on logout');
  }
}

/**
 * Delete rows that can no longer authorize anything.
 *
 * Kept 7 days past expiry rather than deleted on expiry: a reuse attempt with a
 * just-expired token is still worth seeing as a REUSE warning in the log rather
 * than an anonymous `invalid`.
 */
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const { count } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  if (count > 0) logger.info({ count }, 'Pruned expired refresh tokens');
  return count;
}
