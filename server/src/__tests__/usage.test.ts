import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    usageRecord: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));

import {
  assertUnderEmailLimit,
  LimitExceededError,
  TIER_EMAIL_LIMITS,
  invalidateUsageAnchor,
} from '../billing/usage.js';

let userCounter = 0;
/** Fresh userId per test so the in-process anchor cache never leaks between cases. */
function freshUserId(): string {
  userCounter += 1;
  const id = `usage-test-user-${userCounter}`;
  invalidateUsageAnchor(id);
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertUnderEmailLimit', () => {
  it('allows a send when usage is under the FREE tier cap', async () => {
    const userId = freshUserId();
    prismaMock.user.findUnique.mockResolvedValue({ currentPeriodStart: null, tier: 'FREE' });
    prismaMock.usageRecord.findUnique.mockResolvedValue({ emailsSent: TIER_EMAIL_LIMITS.FREE - 1 });

    await expect(assertUnderEmailLimit(userId)).resolves.toBeUndefined();
  });

  it('throws LimitExceededError once usage reaches the tier cap', async () => {
    const userId = freshUserId();
    prismaMock.user.findUnique.mockResolvedValue({ currentPeriodStart: null, tier: 'FREE' });
    prismaMock.usageRecord.findUnique.mockResolvedValue({ emailsSent: TIER_EMAIL_LIMITS.FREE });

    await expect(assertUnderEmailLimit(userId)).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('carries the tier, limit, and used count on the error for callers to report', async () => {
    const userId = freshUserId();
    prismaMock.user.findUnique.mockResolvedValue({ currentPeriodStart: null, tier: 'PRO' });
    prismaMock.usageRecord.findUnique.mockResolvedValue({ emailsSent: TIER_EMAIL_LIMITS.PRO + 50 });

    try {
      await assertUnderEmailLimit(userId);
      throw new Error('expected assertUnderEmailLimit to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LimitExceededError);
      const limitErr = err as LimitExceededError;
      expect(limitErr.tier).toBe('PRO');
      expect(limitErr.limit).toBe(TIER_EMAIL_LIMITS.PRO);
      expect(limitErr.used).toBe(TIER_EMAIL_LIMITS.PRO + 50);
      expect(limitErr.status).toBe(402);
      expect(limitErr.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('treats a tenant with no usage record yet as 0 used (never blocks a first send)', async () => {
    const userId = freshUserId();
    prismaMock.user.findUnique.mockResolvedValue({ currentPeriodStart: null, tier: 'FREE' });
    prismaMock.usageRecord.findUnique.mockResolvedValue(null);

    await expect(assertUnderEmailLimit(userId)).resolves.toBeUndefined();
  });

  it('AGENCY tier has a higher cap than PRO, which is higher than FREE', () => {
    expect(TIER_EMAIL_LIMITS.AGENCY).toBeGreaterThan(TIER_EMAIL_LIMITS.PRO);
    expect(TIER_EMAIL_LIMITS.PRO).toBeGreaterThan(TIER_EMAIL_LIMITS.FREE);
  });

  it('defaults to FREE-tier limits when the user row is missing (defensive)', async () => {
    const userId = freshUserId();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.usageRecord.findUnique.mockResolvedValue({ emailsSent: TIER_EMAIL_LIMITS.FREE });

    await expect(assertUnderEmailLimit(userId)).rejects.toMatchObject({ tier: 'FREE' });
  });
});
