import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { mayPoll, reportWork, pulseState, resetPulseForTests } from '../scheduler/pulse.js';

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
