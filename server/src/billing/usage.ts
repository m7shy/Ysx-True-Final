import { randomUUID } from 'node:crypto';
import { SubscriptionTier } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

/**
 * Metered usage tracker: emails sent per tenant per billing cycle.
 *
 * Hot path (`recordEmailSent`) is designed for the send choke points in
 * smtpGateway.ts, which can fire concurrently from the campaign worker, the
 * followup scheduler, and API requests:
 *
 *   1. The tenant's billing-cycle anchor (User.currentPeriodStart) is read
 *      through a short in-process TTL cache, so steady-state sends cost ONE
 *      database statement, not two.
 *   2. The counter bump is a single atomic
 *      `INSERT ... ON CONFLICT DO UPDATE SET emailsSent = emailsSent + n`,
 *      so concurrent increments never lose updates and never need a
 *      read-modify-write transaction.
 *
 * Tenants without a Stripe subscription (FREE tier) have no Stripe anchor;
 * their usage buckets fall back to the UTC calendar month.
 */

const ANCHOR_CACHE_TTL_MS = 60_000;

interface AnchorCacheEntry {
  periodStart: Date | null; // null = no Stripe anchor → calendar-month bucket
  tier: SubscriptionTier;
  expiresAt: number;
}

const anchorCache = new Map<string, AnchorCacheEntry>();

/** Webhooks call this when they move a tenant's cycle so new sends bucket correctly at once. */
export function invalidateUsageAnchor(userId: string): void {
  anchorCache.delete(userId);
}

function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function resolveAnchor(userId: string): Promise<{ periodStart: Date; tier: SubscriptionTier }> {
  const now = Date.now();
  const cached = anchorCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { periodStart: cached.periodStart ?? utcMonthStart(new Date(now)), tier: cached.tier };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentPeriodStart: true, tier: true },
  });
  const periodStart = user?.currentPeriodStart ?? null;
  const tier = user?.tier ?? SubscriptionTier.FREE;
  anchorCache.set(userId, { periodStart, tier, expiresAt: now + ANCHOR_CACHE_TTL_MS });
  return { periodStart: periodStart ?? utcMonthStart(new Date(now)), tier };
}

async function resolvePeriodStart(userId: string): Promise<Date> {
  const { periodStart } = await resolveAnchor(userId);
  return periodStart;
}

/**
 * Per-tier email sends allowed per billing cycle. App config, not DB (see
 * schema.prisma SubscriptionTier comment) — adding/adjusting a tier is a
 * code-only change.
 */
export const TIER_EMAIL_LIMITS: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 200,
  [SubscriptionTier.PRO]: 5000,
  [SubscriptionTier.AGENCY]: 25000,
};

export class LimitExceededError extends Error {
  status = 402;
  code = 'LIMIT_EXCEEDED';
  constructor(public tier: SubscriptionTier, public limit: number, public used: number) {
    super(`Email send limit reached for the ${tier} plan (${used}/${limit} this billing cycle).`);
    this.name = 'LimitExceededError';
  }
}

/**
 * Throws LimitExceededError when the tenant has hit its tier's per-cycle
 * email cap. Called from the send choke points (smtpGateway.ts) so every
 * send path — worker, follow-ups, manual compose — is capped consistently.
 */
export async function assertUnderEmailLimit(userId: string): Promise<void> {
  const { periodStart, tier } = await resolveAnchor(userId);
  const limit = TIER_EMAIL_LIMITS[tier];
  const record = await prisma.usageRecord.findUnique({
    where: { userId_periodStart: { userId, periodStart } },
    select: { emailsSent: true },
  });
  const used = record?.emailsSent ?? 0;
  if (used >= limit) {
    throw new LimitExceededError(tier, limit, used);
  }
}

/**
 * Log `count` sent emails against the tenant's current billing cycle.
 * Never throws: metering must not break the send path, so failures are
 * logged and swallowed.
 */
export async function recordEmailSent(userId: string, count = 1): Promise<void> {
  try {
    const periodStart = await resolvePeriodStart(userId);
    await prisma.$executeRaw`
      INSERT INTO "UsageRecord" ("id", "userId", "periodStart", "emailsSent", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${periodStart}, ${count}, NOW(), NOW())
      ON CONFLICT ("userId", "periodStart")
      DO UPDATE SET "emailsSent" = "UsageRecord"."emailsSent" + ${count}, "updatedAt" = NOW()
    `;
  } catch (err) {
    logger.error({ err, userId, count }, 'Failed to record email usage');
  }
}

/** Emails sent by the tenant in its current billing cycle (0 if none logged). */
export async function getCurrentCycleUsage(
  userId: string,
): Promise<{ periodStart: Date; emailsSent: number }> {
  const periodStart = await resolvePeriodStart(userId);
  const record = await prisma.usageRecord.findUnique({
    where: { userId_periodStart: { userId, periodStart } },
    select: { emailsSent: true },
  });
  return { periodStart, emailsSent: record?.emailsSent ?? 0 };
}
