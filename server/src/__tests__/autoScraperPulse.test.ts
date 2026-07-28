// FILE: server/src/__tests__/autoScraperPulse.test.ts
//
// The auto-scraper scheduler must respect the shared idle gate.
//
// Background, because this is the bug that took production down twice over:
// Neon's free plan bills COMPUTE TIME and suspends the database after 5 minutes
// idle. Any timer that queries it more often than that keeps it awake forever.
// A previous session found four such timers (follow-ups, campaign worker, reply
// poller, watchdog) and put them behind mayPoll() — and missed this one, which
// queries every 5 minutes, exactly at the suspend threshold. On its own that is
// enough to defeat the entire fix.
//
// Measured on 2026-07-28: 110.24 CU-hours used against a 100 CU-hour monthly
// allowance, and production was suspended for it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { state, spies } = vi.hoisted(() => ({
  state: { mayPoll: true },
  spies: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
}));

vi.mock('../scheduler/pulse.js', () => ({
  mayPoll: () => state.mayPoll,
  reportWork: () => {},
  reportActivity: () => {},
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    scraperSchedule: {
      findMany: spies.findMany,
      updateMany: spies.updateMany,
      update: async () => ({}),
    },
    scraperSettings: { findUnique: async () => null },
  },
}));

vi.mock('../config.js', () => ({
  config: {
    DATABASE_URL: 'postgres://fake',
    SCRAPER_DIR: 'C:/fake/scraper',
    NODE_ENV: 'development',
  },
}));

vi.mock('../scraper/service.js', () => ({
  startAutoJob: async () => ({}),
  activeJobFor: () => null,
}));

const TICK_MS = 300_000; // the production default: every 5 minutes

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.resetModules();
  state.mayPoll = true;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fresh module each time — startAutoScraperScheduler has a module-level `started` latch. */
async function startScheduler() {
  const mod = await import('../scraper/autoScheduler.js');
  mod.startAutoScraperScheduler({ tickMs: TICK_MS });
  // Let the immediate boot tick settle so later assertions measure only the
  // interval-driven ticks.
  await vi.advanceTimersByTimeAsync(0);
  spies.findMany.mockClear();
}

describe('auto-scraper scheduler idle gate', () => {
  it('does NOT touch the database while the pulse says the system is idle', async () => {
    state.mayPoll = false;
    await startScheduler();

    // Half an hour of ticks — six at the production interval.
    await vi.advanceTimersByTimeAsync(TICK_MS * 6);

    expect(spies.findMany).not.toHaveBeenCalled();
  });

  it('queries normally while the pulse says the system is active', async () => {
    state.mayPoll = true;
    await startScheduler();

    await vi.advanceTimersByTimeAsync(TICK_MS);

    expect(spies.findMany).toHaveBeenCalled();
  });

  it('resumes querying once the pulse wakes back up', async () => {
    state.mayPoll = false;
    await startScheduler();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(spies.findMany).not.toHaveBeenCalled();

    state.mayPoll = true;
    await vi.advanceTimersByTimeAsync(TICK_MS);

    expect(spies.findMany).toHaveBeenCalled();
  });
});
