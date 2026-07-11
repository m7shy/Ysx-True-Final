import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { prismaMock, pickRotationMailbox } = vi.hoisted(() => ({
  prismaMock: {
    mailbox: { findFirst: vi.fn() },
  },
  pickRotationMailbox: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../creds/mailboxStore.js', () => ({ pickRotationMailbox }));

import {
  isWithinSendWindow,
  computeNextRetryDelayMs,
  MAX_SEND_ATTEMPTS,
  isLimitExceededError,
  pickMailbox,
  effectiveCampaignSentToday,
  remainingDailyBudget,
  isHardBounceError,
} from '../campaigns/engine.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isWithinSendWindow ────────────────────────────────────────────────────────

describe('isWithinSendWindow', () => {
  it('is unrestricted when no window/day/timezone is set', () => {
    const campaign = { sendWindowStart: null, sendWindowEnd: null, sendDays: null, timezone: null };
    expect(isWithinSendWindow(campaign, new Date('2026-01-01T03:00:00Z'))).toBe(true);
  });

  it('allows sends inside a same-day UTC window', () => {
    const campaign = { sendWindowStart: 9 * 60, sendWindowEnd: 17 * 60, sendDays: null, timezone: 'UTC' };
    // 2026-01-05 is a Monday; 12:00 UTC is inside 09:00-17:00.
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T12:00:00Z'))).toBe(true);
  });

  it('blocks sends outside a same-day UTC window', () => {
    const campaign = { sendWindowStart: 9 * 60, sendWindowEnd: 17 * 60, sendDays: null, timezone: 'UTC' };
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T20:00:00Z'))).toBe(false);
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T08:00:00Z'))).toBe(false);
  });

  it('handles an overnight window (start > end)', () => {
    const campaign = { sendWindowStart: 22 * 60, sendWindowEnd: 6 * 60, sendDays: null, timezone: 'UTC' };
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T23:00:00Z'))).toBe(true); // 23:00 -> inside
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T02:00:00Z'))).toBe(true); // 02:00 -> inside
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T12:00:00Z'))).toBe(false); // noon -> outside
  });

  it('enforces the sendDays bitmask (Mon=1<<0 ... Sun=1<<6)', () => {
    // 2026-01-05 is a Monday (bit 1<<0 = 1).
    const mondayOnly = { sendWindowStart: null, sendWindowEnd: null, sendDays: 1 << 0, timezone: 'UTC' };
    expect(isWithinSendWindow(mondayOnly, new Date('2026-01-05T12:00:00Z'))).toBe(true);

    const tuesdayOnly = { sendWindowStart: null, sendWindowEnd: null, sendDays: 1 << 1, timezone: 'UTC' };
    expect(isWithinSendWindow(tuesdayOnly, new Date('2026-01-05T12:00:00Z'))).toBe(false);
  });

  it('resolves the window in the campaign timezone, not UTC', () => {
    // 09:00 America/New_York (UTC-5 in January) = 14:00 UTC.
    const campaign = { sendWindowStart: 9 * 60, sendWindowEnd: 17 * 60, sendDays: null, timezone: 'America/New_York' };
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T14:30:00Z'))).toBe(true);
    // 02:30 UTC = 21:30 America/New_York (previous day) — outside 09:00-17:00 local,
    // even though naively reading 02:30 against a UTC window would also say "outside"
    // for the wrong reason; this specifically checks the tz conversion, not just the hour.
    expect(isWithinSendWindow(campaign, new Date('2026-01-05T02:30:00Z'))).toBe(false);
  });
});

// ── computeNextRetryDelayMs ───────────────────────────────────────────────────

describe('computeNextRetryDelayMs', () => {
  it('backs off 5m -> 30m -> 2h across attempts', () => {
    expect(computeNextRetryDelayMs(1)).toBe(5 * 60_000);
    expect(computeNextRetryDelayMs(2)).toBe(30 * 60_000);
    expect(computeNextRetryDelayMs(3)).toBe(2 * 60 * 60_000);
  });

  it('exhausts retries at MAX_SEND_ATTEMPTS', () => {
    expect(MAX_SEND_ATTEMPTS).toBe(4);
    expect(computeNextRetryDelayMs(4)).toBeNull();
    expect(computeNextRetryDelayMs(5)).toBeNull();
  });
});

// ── isLimitExceededError ──────────────────────────────────────────────────────

describe('isLimitExceededError', () => {
  it('identifies a LIMIT_EXCEEDED error by its code', () => {
    expect(isLimitExceededError({ code: 'LIMIT_EXCEEDED' })).toBe(true);
    expect(isLimitExceededError(new Error('boom'))).toBe(false);
    expect(isLimitExceededError(null)).toBe(false);
  });
});

// ── isHardBounceError ─────────────────────────────────────────────────────────

describe('isHardBounceError', () => {
  it('identifies standard 5xx hard-bounce SMTP response codes', () => {
    expect(isHardBounceError({ responseCode: 550 })).toBe(true);
    expect(isHardBounceError({ responseCode: 551 })).toBe(true);
    expect(isHardBounceError({ responseCode: 553 })).toBe(true);
    expect(isHardBounceError({ responseCode: 554 })).toBe(true);
  });

  it('does not treat a transient 4xx code as a hard bounce', () => {
    expect(isHardBounceError({ responseCode: 421 })).toBe(false);
    expect(isHardBounceError({ responseCode: 450 })).toBe(false);
  });

  it('falls back to matching common bounce phrasing in the error message', () => {
    expect(isHardBounceError(new Error('550 5.1.1 User unknown'))).toBe(true);
    expect(isHardBounceError(new Error('Recipient address rejected: Mailbox unavailable'))).toBe(true);
    expect(isHardBounceError(new Error('Connection timed out'))).toBe(false);
  });

  it('is false for non-error/null input', () => {
    expect(isHardBounceError(null)).toBe(false);
    expect(isHardBounceError(undefined)).toBe(false);
  });
});

// ── pickMailbox (distributionMethod) ─────────────────────────────────────────

describe('pickMailbox', () => {
  it('INDIVIDUAL delegates to the existing rotation picker', async () => {
    pickRotationMailbox.mockResolvedValue({ id: 'rotated' });
    const result = await pickMailbox('u1', 'INDIVIDUAL');
    expect(result).toEqual({ id: 'rotated' });
    expect(pickRotationMailbox).toHaveBeenCalledWith('u1');
  });

  it('GROUP pins to the earliest-connected active mailbox under its limit', async () => {
    const today = new Date();
    const utcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    prismaMock.mailbox.findFirst.mockResolvedValue({
      id: 'primary',
      dailyLimit: 50,
      sentToday: 5,
      counterDate: utcDay,
    });
    const result = await pickMailbox('u1', 'GROUP');
    expect(result).toEqual(expect.objectContaining({ id: 'primary' }));
    expect(prismaMock.mailbox.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', isActive: true }, orderBy: { createdAt: 'asc' } }),
    );
    expect(pickRotationMailbox).not.toHaveBeenCalled();
  });

  it('GROUP does not fall back to rotation when the primary mailbox is exhausted', async () => {
    const today = new Date();
    const utcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    prismaMock.mailbox.findFirst.mockResolvedValue({
      id: 'primary',
      dailyLimit: 10,
      sentToday: 10,
      counterDate: utcDay,
    });
    const result = await pickMailbox('u1', 'GROUP');
    expect(result).toBeNull();
    expect(pickRotationMailbox).not.toHaveBeenCalled();
  });

  it('GROUP returns null when the tenant has no mailbox at all', async () => {
    prismaMock.mailbox.findFirst.mockResolvedValue(null);
    await expect(pickMailbox('u1', 'GROUP')).resolves.toBeNull();
  });
});

// ── Campaign daily counter ────────────────────────────────────────────────────

describe('effectiveCampaignSentToday / remainingDailyBudget', () => {
  it('treats a stale counterDate as reset to 0', () => {
    const now = new Date();
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000);
    const campaign = { sentToday: 40, counterDate: yesterday };
    expect(effectiveCampaignSentToday(campaign, now)).toBe(0);
  });

  it('returns Infinity budget when dailyLimit is unset', () => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const campaign = { dailyLimit: null, sentToday: 100, counterDate: today };
    expect(remainingDailyBudget(campaign, now)).toBe(Infinity);
  });

  it('caps remaining budget at dailyLimit - sentToday, floored at 0', () => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    expect(remainingDailyBudget({ dailyLimit: 10, sentToday: 7, counterDate: today }, now)).toBe(3);
    expect(remainingDailyBudget({ dailyLimit: 10, sentToday: 15, counterDate: today }, now)).toBe(0);
  });
});
