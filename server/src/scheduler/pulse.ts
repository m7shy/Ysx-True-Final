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
 * How often a gated poller's TIMER fires. Deliberately shorter than BURST_MS.
 *
 * `mayPoll` serves at most one turn per poller per burst — but a poller only
 * receives that turn if one of its ticks happens to land INSIDE the window.
 * A poller whose own interval is longer than BURST_MS usually has no tick in
 * there, and since the burst is re-anchored by the 10s follow-up scheduler on a
 * grid that divides IDLE_POLL_MS exactly, the phase is fixed at boot and never
 * drifts. The result is permanent starvation, not occasional lateness.
 *
 * Measured over 14 simulated idle days before this existed: the reply poller and
 * auto-scraper (both 300s) got 2 turns at roughly 70% of boot phases, and the
 * watchdog (900s) got 1 turn at every phase tried — i.e. reply detection,
 * scraping and alerting all silently stopped whenever the system went idle.
 *
 * A ticker faster than the window cannot miss it, so the logical cadence is
 * enforced by startGatedPoller instead of by the timer period.
 */
const GATE_TICK_MS = Math.max(1_000, Math.min(30_000, Math.floor(BURST_MS / 3)));

/**
 * Run `run` on its logical `intervalMs` cadence while respecting the idle gate.
 *
 * Use this for anything that touches the database on a timer. Calling
 * `setInterval(fn, longInterval)` and gating inside `fn` is the shape that
 * starves — see GATE_TICK_MS above.
 *
 * Ordering matters: due-ness is checked BEFORE `mayPoll`, so a tick that is not
 * due yet cannot consume the single burst turn that a due poller needs.
 */
export function startGatedPoller(opts: {
  /** Gate identity — must be unique per poller; shares the one-turn-per-burst budget. */
  name: string;
  /** Logical cadence. Honoured exactly while active; becomes once-per-burst while idle. */
  intervalMs: number;
  run: () => Promise<void>;
  /** Run on the first tick rather than waiting a full interval. Default false. */
  runImmediately?: boolean;
}): ReturnType<typeof setInterval> {
  const { name, intervalMs, run, runImmediately = false } = opts;
  let lastRunAt = runImmediately ? 0 : Date.now();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // a slow pass must not overlap the next tick
    if (Date.now() - lastRunAt < intervalMs) return; // not due yet
    if (!mayPoll(name)) return; // due, but the gate says wait for the burst
    running = true;
    lastRunAt = Date.now();
    try {
      await run();
    } catch (err) {
      logger.error({ err, poller: name }, 'Gated poller tick failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, Math.min(GATE_TICK_MS, intervalMs));

  // `setInterval` alone waits a full tick before the first run. The reply poller
  // and auto-scraper both called their tick directly at startup before moving to
  // this helper, and losing that would delay the first pass by up to
  // GATE_TICK_MS on every boot — a silent behaviour change smuggled in by a
  // refactor.
  if (runImmediately) void tick();

  return timer;
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
