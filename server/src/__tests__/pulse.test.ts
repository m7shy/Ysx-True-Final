import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { mayPoll, reportWork, pulseState, resetPulseForTests, startGatedPoller } from '../scheduler/pulse.js';

/**
 * The idle gate that lets a serverless database scale to zero.
 *
 * This exists because four independent pollers queried Postgres forever — the
 * follow-up scheduler every 10s, the campaign worker every 60s, the reply
 * poller every 5 min, the watchdog every 15 — so the compute never suspended
 * and burned ~730 hours a month against a ~190-hour free allowance. On
 * 2026-07-28 it ran out and took production down.
 *
 * The failure mode of getting this wrong is SILENT in both directions: too
 * eager and nothing ever sleeps (the bug we started with), too aggressive and
 * the workers quietly stop working with no error anywhere. Hence the coverage.
 */

// Defaults from pulse.ts (env-overridable there, unset here).
const ACTIVE_GRACE_MS = 10 * 60_000;
const IDLE_POLL_MS = 30 * 60_000;
const BURST_MS = 90_000;

beforeEach(() => {
  vi.useFakeTimers();
  resetPulseForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pulse — active mode', () => {
  it('allows every poller through while work is recent', () => {
    expect(mayPoll('campaignWorker')).toBe(true);
    expect(mayPoll('followupScheduler')).toBe(true);
    // Repeated calls are unrestricted: this is the normal fast cadence.
    expect(mayPoll('campaignWorker')).toBe(true);
    expect(pulseState().mode).toBe('active');
  });

  it('stays active for the whole grace period', () => {
    vi.advanceTimersByTime(ACTIVE_GRACE_MS - 1000);
    expect(mayPoll('campaignWorker')).toBe(true);
    expect(pulseState().mode).toBe('active');
  });
});

describe('pulse — idle mode', () => {
  function goIdle() {
    vi.advanceTimersByTime(ACTIVE_GRACE_MS + 1000);
    // First call after the grace period opens the first burst.
    mayPoll('primer');
    // Close it.
    vi.advanceTimersByTime(BURST_MS + 1000);
  }

  it('drops to idle once nothing has reported work', () => {
    vi.advanceTimersByTime(ACTIVE_GRACE_MS + 1000);
    mayPoll('campaignWorker');
    expect(pulseState().mode).toBe('idle');
  });

  it('refuses polls between bursts — the actual point of the mechanism', () => {
    goIdle();

    // Ten minutes into the idle interval: still closed. If this returned true,
    // the compute would never suspend and nothing would have been fixed.
    vi.advanceTimersByTime(10 * 60_000);
    expect(mayPoll('campaignWorker')).toBe(false);
    expect(mayPoll('followupScheduler')).toBe(false);
    expect(mayPoll('watchdog')).toBe(false);
  });

  it('opens a burst every idle interval and lets each poller take one turn', () => {
    goIdle();
    vi.advanceTimersByTime(IDLE_POLL_MS);

    // All three get through in the same window — aligning them is what makes
    // the wake cheap; staggered wakes would each pay the suspend delay again.
    expect(mayPoll('campaignWorker')).toBe(true);
    expect(mayPoll('followupScheduler')).toBe(true);
    expect(mayPoll('watchdog')).toBe(true);

    // ...but only one turn each, so the 10-second poller cannot consume the
    // whole window and starve the others.
    expect(mayPoll('campaignWorker')).toBe(false);
    expect(mayPoll('followupScheduler')).toBe(false);
  });

  it('closes the burst and stays shut until the next interval', () => {
    goIdle();
    vi.advanceTimersByTime(IDLE_POLL_MS);
    expect(mayPoll('campaignWorker')).toBe(true);

    vi.advanceTimersByTime(BURST_MS + 1000);
    expect(mayPoll('campaignWorker')).toBe(false);

    vi.advanceTimersByTime(IDLE_POLL_MS);
    expect(mayPoll('campaignWorker')).toBe(true);
  });

  it('reports how long until the next wake, so stale ticks are explicable', () => {
    goIdle();
    const state = pulseState();
    expect(state.mode).toBe('idle');
    expect(state.msToNextWake).toBeGreaterThan(0);
    expect(state.msToNextWake).toBeLessThanOrEqual(IDLE_POLL_MS);
  });
});

describe('pulse — waking up', () => {
  it('returns to full cadence the moment real work is reported', () => {
    vi.advanceTimersByTime(ACTIVE_GRACE_MS + 1000);
    mayPoll('campaignWorker');
    vi.advanceTimersByTime(BURST_MS + 1000);
    expect(mayPoll('campaignWorker')).toBe(false);

    // An active campaign, a due follow-up, or a user request.
    reportWork();

    expect(mayPoll('campaignWorker')).toBe(true);
    expect(mayPoll('campaignWorker')).toBe(true);
    expect(pulseState().mode).toBe('active');
  });

  it('does not go back to sleep while work keeps arriving', () => {
    // Work every 9 minutes, inside the 10-minute grace: must never idle, or a
    // running campaign would stall for half an hour at a time.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(9 * 60_000);
      reportWork();
      expect(mayPoll('campaignWorker')).toBe(true);
      expect(pulseState().mode).toBe('active');
    }
  });
});

/**
 * Regression: pollers slower than the burst window starved permanently.
 *
 * The original shape was `setInterval(() => { if (!mayPoll(name)) return; ... },
 * LONG_INTERVAL)`. A poller only gets its turn if one of its ticks lands INSIDE
 * the 90s window, and because the burst is re-anchored on a grid that divides
 * IDLE_POLL_MS exactly, that phase is fixed at boot and never drifts. Measured
 * over 14 simulated idle days before the fix: the 5-minute pollers (reply
 * detection, auto-scraper) got 2 turns at ~70% of boot phases and the 15-minute
 * watchdog got 1 turn at EVERY phase tried.
 *
 * Nothing errored. Reply detection, scraping and alerting simply stopped
 * whenever the system went quiet — which is exactly when an unnoticed failure
 * matters most. This file's own header warns about that failure mode; it just
 * had no test for it.
 */
describe('pulse — startGatedPoller does not starve slow pollers', () => {
  /**
   * Runs a poller for `spanMs` of idle time and reports how often it actually ran.
   *
   * The 10-second anchor below is NOT scenery — it is the mechanism. In
   * production the follow-up scheduler ticks every 10s and is therefore always
   * the poller that OPENS each burst, which pins the burst grid to its cadence;
   * every slower poller then has to land inside a window somebody else opened.
   * A probe running alone opens the burst itself and is served every time, so it
   * cannot reproduce the bug — verified the hard way: without this anchor these
   * tests passed against the starving implementation.
   */
  async function countIdleRuns(opts: {
    intervalMs: number;
    bootPhaseMs: number;
    spanMs: number;
  }): Promise<number> {
    resetPulseForTests();
    const anchor = setInterval(() => {
      mayPoll('anchor-followup');
    }, 10_000);

    // Let the grace period lapse with nothing reporting work, so we are idle.
    await vi.advanceTimersByTimeAsync(ACTIVE_GRACE_MS + 1_000);
    // Shift the poller's tick grid relative to the burst grid. This is the
    // variable that decided starvation before, so it is the variable to sweep.
    await vi.advanceTimersByTimeAsync(opts.bootPhaseMs);

    let runs = 0;
    const timer = startGatedPoller({
      name: `probe-${opts.intervalMs}-${opts.bootPhaseMs}`,
      intervalMs: opts.intervalMs,
      run: async () => {
        runs++;
      },
    });
    await vi.advanceTimersByTimeAsync(opts.spanMs);
    clearInterval(timer);
    clearInterval(anchor);
    return runs;
  }

  const SIX_HOURS = 6 * 60 * 60_000; // 12 idle windows
  const PHASES = [0, 30_000, 90_000, 200_000, 437_000];

  it.each(PHASES)(
    'serves the 15-minute watchdog cadence at boot phase %ims (was 0 at every phase)',
    async (bootPhaseMs) => {
      const runs = await countIdleRuns({ intervalMs: 15 * 60_000, bootPhaseMs, spanMs: SIX_HOURS });
      // One turn per idle window is the design; 12 windows in six hours.
      expect(runs).toBeGreaterThanOrEqual(10);
    },
  );

  it.each(PHASES)(
    'serves the 5-minute poller cadence at boot phase %ims (was 2 in 14 days at most phases)',
    async (bootPhaseMs) => {
      const runs = await countIdleRuns({ intervalMs: 5 * 60_000, bootPhaseMs, spanMs: SIX_HOURS });
      expect(runs).toBeGreaterThanOrEqual(10);
    },
  );

  it('still lets a poller faster than the burst window through', async () => {
    const runs = await countIdleRuns({ intervalMs: 60_000, bootPhaseMs: 0, spanMs: SIX_HOURS });
    expect(runs).toBeGreaterThanOrEqual(10);
  });

  it('does not exceed one run per idle window, however fast it ticks', async () => {
    // The saving depends on this: a fast ticker must not turn into a fast poller.
    const runs = await countIdleRuns({ intervalMs: 60_000, bootPhaseMs: 0, spanMs: SIX_HOURS });
    expect(runs).toBeLessThanOrEqual(13);
  });

  it('honours the logical interval while active, rather than the tick rate', async () => {
    // Active mode must not inherit the 30s ticker as its cadence.
    resetPulseForTests();
    let runs = 0;
    const timer = startGatedPoller({
      name: 'probe-active',
      intervalMs: 5 * 60_000,
      run: async () => {
        runs++;
        reportWork(); // keep the system active for the whole span
      },
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000); // 30 min at a 5 min cadence
    clearInterval(timer);
    expect(runs).toBeGreaterThanOrEqual(5);
    expect(runs).toBeLessThanOrEqual(7);
  });
});
