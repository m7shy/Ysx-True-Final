// FILE: server/src/scraper/autoScheduler.ts

import { Prisma, ScraperScheduleStatus, type ScraperSchedule } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { startAutoJob, activeJobFor } from './service.js';
import { mayPoll, reportWork } from '../scheduler/pulse.js';

/**
 * Automatic per-tenant scraper scheduler, backed by the `ScraperSchedule`
 * table. Mirrors server/src/scheduler/followupScheduler.ts's shape (in-process
 * setInterval ticker, atomic status compare-and-set claim), adapted for two
 * differences from follow-up jobs: a scraper run takes real minutes (not a
 * quick send), and jobs are per-*tenant* rather than per-item, so the ticker
 * caps how many run concurrently across ALL tenants at once — many accounts
 * auto-scraping simultaneously from this backend's one egress IP would look
 * exactly like the bot-farm pattern the cookie/format-resolution fixes were
 * built to avoid.
 */

// Fresh keywords generated per auto-run, when a tenant hasn't set their own
// via ScraperSettings.keywordsPerAutoRun (see routes.ts's /settings PATCH).
// Deliberately smaller than the standalone daemon's 10/day default (see
// orchestrator.py): at 3-5 runs/day this keeps total daily keyword/YouTube
// volume per tenant modest ("spread into tiny pieces" implies gentler
// bursts, not one big daily sweep).
const DEFAULT_KEYWORDS_PER_AUTO_RUN = 4;

// Across ALL tenants, not per-tenant — startAutoJob's own activeJobFor guard
// already prevents a tenant from double-running.
const MAX_CONCURRENT_AUTO_RUNS = 2;

// runningCount (the concurrency budget) is in-memory only: if the process
// crashes mid-run, a schedule claimed as RUNNING has no in-process finally{}
// left to release it, and stays RUNNING forever — silently halting that
// tenant's auto-scrape permanently. A RUNNING row whose runStartedAt is
// older than this timeout is treated as crashed and reset to IDLE.
const STALE_RUN_TIMEOUT_MS = 30 * 60_000;

/**
 * Pick the next auto-run time after `after`: divide the day into `runsPerDay`
 * equal slots and land on a random point within the middle 80% of the first
 * slot that hasn't already passed (rolling into tomorrow's first slot if
 * every slot today is already behind `after`). Used both for a brand-new
 * schedule's first run (auth/routes.ts signup hook) and for advancing a
 * schedule after each completed run.
 */
export function computeNextRunTime(after: Date, runsPerDay: number): Date {
  const slotHours = 24 / runsPerDay;
  const slotMs = slotHours * 3_600_000;
  const dayStart = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());

  for (let i = 0; i < runsPerDay; i++) {
    const slotStartMs = dayStart + i * slotMs;
    const jitteredMs = slotStartMs + (0.1 + Math.random() * 0.8) * slotMs;
    if (jitteredMs > after.getTime()) return new Date(jitteredMs);
  }

  // Every slot today has already passed — first slot tomorrow.
  const tomorrowStart = dayStart + 24 * 3_600_000;
  return new Date(tomorrowStart + (0.1 + Math.random() * 0.8) * slotMs);
}

let started = false;
let ticking = false;
let runningCount = 0;

/** Run one tenant's auto-scrape to completion, then release its claim. */
async function runOne(schedule: ScraperSchedule): Promise<void> {
  let lastRunSummary: Record<string, unknown>;
  try {
    const settings = await prisma.scraperSettings.findUnique({
      where: { userId: schedule.userId },
      select: { keywordsPerAutoRun: true },
    });
    const keywordCount = settings?.keywordsPerAutoRun ?? DEFAULT_KEYWORDS_PER_AUTO_RUN;
    const job = await startAutoJob(schedule.userId, keywordCount);
    lastRunSummary =
      job.status === 'succeeded'
        ? { created: job.summary?.created ?? 0, updated: job.summary?.updated ?? 0, skipped: job.summary?.skipped ?? 0 }
        : { created: 0, updated: 0, skipped: 0, error: job.error ?? 'auto-scrape failed' };
  } catch (err) {
    logger.error({ err, userId: schedule.userId }, 'auto-scrape failed to start');
    lastRunSummary = { created: 0, updated: 0, skipped: 0, error: err instanceof Error ? err.message : 'failed to start' };
  }

  try {
    await prisma.scraperSchedule.update({
      where: { id: schedule.id },
      data: {
        status: ScraperScheduleStatus.IDLE,
        runStartedAt: null,
        lastRunAt: new Date(),
        lastRunSummary: lastRunSummary as Prisma.InputJsonValue,
        nextRunAt: computeNextRunTime(new Date(), schedule.runsPerDay),
      },
    });
  } catch (err) {
    logger.error({ err, scheduleId: schedule.id }, 'failed to persist auto-scrape schedule update');
  }
}

/**
 * Reset any RUNNING schedule stuck past the stale-run timeout back to IDLE —
 * but only if it's actually orphaned (no matching job still alive in this
 * process's in-memory job map). A YouTube scrape can legitimately run past
 * 30 minutes under cookie rotation/bot-check backoff; blindly reclaiming a
 * schedule that's still genuinely running lets the next tick launch a SECOND
 * overlapping scraper for the same tenant while the first keeps running
 * untracked — both fight over the same profile's keywords.txt/leads.csv and
 * crash. Only a real process crash/restart (no in-memory job at all) should
 * be treated as stale.
 */
async function recoverStaleRuns(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUN_TIMEOUT_MS);
  const stale = await prisma.scraperSchedule.findMany({
    where: {
      status: ScraperScheduleStatus.RUNNING,
      OR: [{ runStartedAt: { lte: staleBefore } }, { runStartedAt: null }],
    },
    select: { id: true, userId: true, runsPerDay: true },
  });
  if (stale.length === 0) return;

  for (const schedule of stale) {
    if (activeJobFor(schedule.userId)) continue; // still genuinely running here — leave it claimed

    await prisma.scraperSchedule.updateMany({
      where: { id: schedule.id, status: ScraperScheduleStatus.RUNNING },
      data: {
        status: ScraperScheduleStatus.IDLE,
        runStartedAt: null,
        lastRunSummary: { created: 0, updated: 0, skipped: 0, error: 'Run stranded past timeout (process restart); recovered automatically.' },
        nextRunAt: computeNextRunTime(new Date(), schedule.runsPerDay),
      },
    });
    logger.warn({ scheduleId: schedule.id, userId: schedule.userId }, 'Recovered a stale RUNNING scraper schedule');
  }
}

/**
 * Single scheduler tick: claims up to the remaining concurrency budget of due,
 * enabled schedules (IDLE -> RUNNING compare-and-set, exactly followupScheduler's
 * idiom) and launches each without awaiting completion — a scrape run can take
 * real minutes, so the tick itself must return quickly and let the next tick
 * (5 min later, by default) claim more work as concurrency frees up.
 */
export async function tickOnce(): Promise<void> {
  if (ticking) return;
  ticking = true;

  try {
    await recoverStaleRuns();

    const available = MAX_CONCURRENT_AUTO_RUNS - runningCount;
    if (available <= 0) return;

    const due = await prisma.scraperSchedule.findMany({
      where: { enabled: true, status: ScraperScheduleStatus.IDLE, nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      take: available,
    });

    // A due schedule is real work: keep the database at full cadence while
    // scrapes are actually being launched, rather than dropping to the idle
    // burst mid-run.
    if (due.length > 0) reportWork();

    for (const schedule of due) {
      const claimed = await prisma.scraperSchedule.updateMany({
        where: { id: schedule.id, status: ScraperScheduleStatus.IDLE },
        data: { status: ScraperScheduleStatus.RUNNING, runStartedAt: new Date() },
      });
      if (claimed.count !== 1) continue; // already claimed by a concurrent tick

      runningCount++;
      void runOne(schedule).finally(() => {
        runningCount--;
      });
    }
  } finally {
    ticking = false;
  }
}

export function startAutoScraperScheduler(options?: { tickMs?: number }): void {
  if (started) return;

  // Needs a database (schedule state) and a configured scraper (SCRAPER_DIR) —
  // without either, there is nothing meaningful to tick.
  if (!config.DATABASE_URL || config.NODE_ENV === 'test' || !config.SCRAPER_DIR) {
    logger.warn('Auto-scraper scheduler not started (no DATABASE_URL/SCRAPER_DIR or test env)');
    return;
  }

  started = true;
  const intervalMs = options?.tickMs && options.tickMs > 0 ? options.tickMs : 300_000;

  void tickOnce().catch((err) => logger.error({ err }, 'Initial auto-scraper tick failed'));

  setInterval(() => {
    // Idle gate — the fifth timer, and it was missed when the other four were
    // gated. It queries the database every 5 minutes, and Neon suspends after
    // 5 minutes idle, so on its own it kept the compute alive permanently and
    // defeated the entire pulse fix. Free-plan allowance is 100 CU-hours per
    // month; the outage of 2026-07-28 was 110.24 against that.
    //
    // Delaying a due scrape by up to one idle-poll window is harmless here:
    // schedules run 3-5x/day, so they are not sensitive to half an hour.
    if (!mayPoll('autoScraper')) return;
    void tickOnce().catch((err) => logger.error({ err }, 'Auto-scraper scheduler tick failed'));
  }, intervalMs);
}
