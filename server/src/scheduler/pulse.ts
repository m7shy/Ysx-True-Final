// FILE: server/src/scheduler/pulse.ts
//
// Shared idle gate for every background poller that touches the database.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Neon (and every other serverless Postgres) bills COMPUTE TIME, and suspends
// the compute after a period with no queries — 5 minutes by default. This app
// had four independent timers hitting the database forever: the follow-up
// scheduler every 10s, the campaign worker every 60s, the reply poller every
// 5 minutes, and the watchdog every 15. Nothing ever let the compute go idle,
// so it ran 24/7 — roughly 730 compute-hours a month against a free-tier
// allowance of about 190.
//
// On 2026-07-28 that allowance ran out three days before its monthly reset and
// took production down completely: `Your account or project has exceeded the
// compute time quota`. Not a spike, not a bug — the steady state was simply
// four times over budget, and had been since the workers were written.
//
// ── How it works ────────────────────────────────────────────────────────────
// Pollers ask `mayPoll(name)` before touching the database, and call
// `reportWork()` when a tick actually did something. While work is happening
// the system stays in ACTIVE mode and every poller runs at its normal cadence.
// After ACTIVE_GRACE_MS with nothing to do it drops to IDLE, where queries are
// allowed only inside a short BURST every IDLE_POLL_MS.
//
// The burst is the important part. Staggered wake-ups would each pay the full
// 5-minute suspend delay, so N pollers waking at N different moments cost N
// times as much as the same N waking together. Aligning them into one window
// is what actually buys the idle time.
//
// Rough duty cycle at the defaults: one ~90s burst every 30 minutes, and the
// compute stays up ~5 minutes after the last query, so ≈5 min busy per 30 min
// ≈ 17% ≈ 120 compute-hours a month. Under the free allowance with headroom,
// and proportionally cheaper on a paid plan.
//
// ── What this deliberately does NOT do ──────────────────────────────────────
// It does not gate HTTP request handling. A user loading the app must never
// wait on a poll window, and their traffic keeps the compute warm anyway —
// which is why `reportActivity()` exists for request handlers to call, so the
// pollers run at full speed while someone is actually using the system.

import { logger } from '../logger.js';

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** How long to keep polling at full speed after the last sign of real work. */
const ACTIVE_GRACE_MS = num(process.env.PULSE_ACTIVE_GRACE_MS, 10 * 60_000);
/** Gap between idle wake-ups. Raise to cut compute cost, at the price of latency. */
const IDLE_POLL_MS = num(process.env.PULSE_IDLE_POLL_MS, 30 * 60_000);
/** How long an idle wake-up stays open, so every poller gets one turn in it. */
const BURST_MS = num(process.env.PULSE_BURST_MS, 90_000);

type Mode = 'active' | 'idle';

let lastWorkAt = Date.now(); // start active: the first ticks must run
let burstUntil = 0;
let nextIdleWakeAt = 0;
let currentMode: Mode = 'active';
/** Pollers that have already had their turn in the open burst. */
const servedThisBurst = new Set<string>();

function setMode(next: Mode, reason: string): void {
  if (currentMode === next) return;
  currentMode = next;
  logger.info(
    { mode: next, reason, idlePollMs: IDLE_POLL_MS },
    next === 'idle'
      ? 'Pulse: going idle — database polling suspended so the compute can scale to zero'
      : 'Pulse: waking — database polling resumed at full cadence',
  );
}

/**
 * Signal that something real happened: a job sent, a reply found, a user
 * request served. Resets the idle countdown.
 */
export function reportWork(): void {
  lastWorkAt = Date.now();
}

/** Alias used by HTTP middleware, to keep the intent readable at the call site. */
export const reportActivity = reportWork;

/**
 * May this poller query the database right now?
 *
 * Each named poller gets at most one turn per burst, so a fast-ticking poller
 * (the follow-up scheduler runs every 10s) cannot spend the whole window by
 * itself and starve the others out of their turn.
 */
export function mayPoll(name: string): boolean {
  const now = Date.now();

  if (now - lastWorkAt < ACTIVE_GRACE_MS) {
    setMode('active', 'recent work');
    return true;
  }

  setMode('idle', 'no work within the grace period');

  // Inside an open burst: one turn each.
  if (now < burstUntil) {
    if (servedThisBurst.has(name)) return false;
    servedThisBurst.add(name);
    return true;
  }

  // Time to open the next burst.
  if (now >= nextIdleWakeAt) {
    burstUntil = now + BURST_MS;
    nextIdleWakeAt = now + IDLE_POLL_MS;
    servedThisBurst.clear();
    servedThisBurst.add(name);
    return true;
  }

  return false;
}

/**
 * Current state, for the deep-health payload — so an operator seeing stale
 * worker ticks can tell "deliberately asleep" from "wedged", which is exactly
 * the distinction the 2026-07-28 alerts could not make.
 */
export function pulseState(): { mode: Mode; msSinceWork: number; msToNextWake: number } {
  const now = Date.now();
  return {
    mode: currentMode,
    msSinceWork: now - lastWorkAt,
    msToNextWake: currentMode === 'active' ? 0 : Math.max(0, nextIdleWakeAt - now),
  };
}

/** Test seam: restore first-run state. */
export function resetPulseForTests(): void {
  lastWorkAt = Date.now();
  burstUntil = 0;
  nextIdleWakeAt = 0;
  currentMode = 'active';
  servedThisBurst.clear();
}
