// FILE: server/src/__tests__/autoScraperPulse.test.ts
//
// The auto-scraper scheduler must respect the shared idle gate — AND still
// actually run while idle.
//
// Background, because this bug had two halves and the second was caused by the
// fix for the first. Neon bills COMPUTE TIME and suspends after 5 minutes idle,
// so any timer querying more often keeps it awake forever. A previous session
// gated four pollers and missed this one, which queries every 5 minutes —
// exactly at the suspend threshold. Measured 2026-07-28: 110.24 CU-hours against
// a 100-hour allowance, and production was suspended for it.
//
// Gating it inside its own 5-minute setInterval fixed the cost and broke the
// function: a 5-minute tick almost never lands inside the 90-second burst
// window, and the burst grid is pinned by the 10-second follow-up scheduler, so
// the phase is fixed at boot and never drifts. Scraping stopped outright at
// roughly 70% of boot phases. Hence startGatedPoller, and hence the anchor in
// these tests.
//
// The real pulse module is used deliberately. Mocking mayPoll would test the
// mock's idea of the gate, and it is the gate's real timing that was wrong.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { spies } = vi.hoisted(() => ({
  spies: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
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
const ACTIVE_GRACE_MS = 10 * 60_000;
const SIX_HOURS = 6 * 60 * 60_000; // 12 idle windows

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Boot the scheduler against the REAL pulse module and run it through `spanMs`
 * of idle time, returning how many times it reached the database.
 *
 * `bootPhaseMs` shifts the scheduler's tick grid relative to the burst grid —
 * the variable that decided starvation. The 10s anchor stands in for the
 * follow-up scheduler, which in production always opens the burst and therefore
 * pins its phase; without a competing poller the scheduler would open every
 * burst itself and could never starve.
 */
async function runIdle(bootPhaseMs: number, spanMs = SIX_HOURS): Promise<number> {
  // Same fresh module registry for both, so they share pulse state.
  const pulse = await import('../scheduler/pulse.js');
  const mod = await import('../scraper/autoScheduler.js');

  const anchor = setInterval(() => {
    pulse.mayPoll('anchor-followup');
  }, 10_000);

  // Order matters, and getting it wrong makes this test vacuous. Phase is
  // RELATIVE: starting the scheduler alongside the anchor and then advancing
  // time moves both grids together, so no offset is ever created and the
  // starving implementation passes. The anchor must be running and the system
  // already idle BEFORE the scheduler starts, so its tick grid lands at
  // `bootPhaseMs` relative to the burst grid the anchor pins.
  await vi.advanceTimersByTimeAsync(ACTIVE_GRACE_MS + 1_000);
  await vi.advanceTimersByTimeAsync(bootPhaseMs);

  mod.startAutoScraperScheduler({ tickMs: TICK_MS });
  spies.findMany.mockClear();

  await vi.advanceTimersByTimeAsync(spanMs);
  clearInterval(anchor);
  return spies.findMany.mock.calls.length;
}

describe('auto-scraper scheduler under the idle gate', () => {
  // The regression. Before startGatedPoller these phases returned 0.
  it.each([0, 90_000, 200_000, 437_000])(
    'still reaches the database while idle at boot phase %ims',
    async (bootPhaseMs) => {
      const calls = await runIdle(bootPhaseMs);
      expect(calls).toBeGreaterThan(0);
    },
  );

  it('polls about once per idle window, not once per tick', async () => {
    // The whole saving depends on this upper bound: six hours at a 5-minute
    // cadence would be 72 ungated polls; 12 idle windows allow ~12.
    // recoverStaleRuns + the due query make two findMany calls per pass.
    const calls = await runIdle(0);
    expect(calls).toBeGreaterThanOrEqual(10);
    expect(calls).toBeLessThanOrEqual(30);
  });

  it('does not poll at all between bursts', async () => {
    const pulse = await import('../scheduler/pulse.js');
    const mod = await import('../scraper/autoScheduler.js');

    mod.startAutoScraperScheduler({ tickMs: TICK_MS });
    await vi.advanceTimersByTimeAsync(ACTIVE_GRACE_MS + 1_000);

    // Consume this window's turn, then sit in the dead zone between bursts.
    pulse.mayPoll('anchor-followup');
    await vi.advanceTimersByTimeAsync(BURST_TAIL_MS);
    spies.findMany.mockClear();
    await vi.advanceTimersByTimeAsync(10 * 60_000); // well inside the quiet gap

    expect(spies.findMany).not.toHaveBeenCalled();
  });
});

// A burst is 90s; step past it before measuring the quiet gap.
const BURST_TAIL_MS = 100_000;
