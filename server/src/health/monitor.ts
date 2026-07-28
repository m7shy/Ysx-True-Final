import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { TIER_EMAIL_LIMITS } from '../billing/usage.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { lastCampaignTickAt } from '../campaigns/worker.js';
import { lastFollowupTickAt } from '../scheduler/followupScheduler.js';
import { smtpFallbackConfigured, sendViaFallbackSmtp } from '../portal/mailer.js';
import { pulseState, startGatedPoller } from '../scheduler/pulse.js';

/**
 * Deep health checks + self-alerting watchdog. Plain /api/health stays a bare
 * liveness 200 (NSSM/Caddy probe); /api/health/deep is for humans and external
 * uptime monitors — NSSM auto-restart has previously masked a crash loop
 * behind the bare 200, so this endpoint checks what actually matters.
 */

export type CheckStatus = 'ok' | 'degraded' | 'critical' | 'disabled';

export interface HealthCheck {
  status: CheckStatus;
  detail: string;
}

export interface DeepHealth {
  status: 'ok' | 'degraded' | 'critical';
  at: string;
  checks: Record<string, HealthCheck>;
}

const TICK_STALE_MS = 5 * 60_000; // both workers tick every 10–60s; 5 min silent = stuck
const DISK_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

const workersEnabled = () => Boolean(config.DATABASE_URL) && config.NODE_ENV !== 'test';

function tickCheck(name: string, last: Date | null): HealthCheck {
  if (!workersEnabled()) return { status: 'disabled', detail: 'not started (no DATABASE_URL or test env)' };

  // A stale tick is EXPECTED while the pulse is idle — that is the whole point
  // of backing off, and reporting it as degraded would turn a working
  // cost-control mechanism into a permanent 6-hourly alert. Report it plainly
  // instead, so "asleep on purpose" and "wedged" stay distinguishable.
  const pulse = pulseState();
  if (pulse.mode === 'idle') {
    return {
      status: 'ok',
      detail: last
        ? `idle — polling suspended, next wake in ${Math.round(pulse.msToNextWake / 1000)}s (last tick ${Math.round((Date.now() - last.getTime()) / 1000)}s ago)`
        : `idle — polling suspended, next wake in ${Math.round(pulse.msToNextWake / 1000)}s`,
    };
  }

  if (!last) return { status: 'degraded', detail: `${name} has not completed a tick since boot` };
  const age = Date.now() - last.getTime();
  return age > TICK_STALE_MS
    ? { status: 'degraded', detail: `last tick ${Math.round(age / 1000)}s ago (stale)` }
    : { status: 'ok', detail: `last tick ${Math.round(age / 1000)}s ago` };
}

export async function runDeepChecks(): Promise<DeepHealth> {
  const checks: Record<string, HealthCheck> = {};

  // Database round-trip — the one check that is critical on failure.
  if (!config.DATABASE_URL) {
    checks.db = { status: 'disabled', detail: 'DATABASE_URL unset' };
  } else {
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = { status: 'ok', detail: 'round-trip ok' };
    } catch (err) {
      // Deliberately generic: this payload is reachable by an uptime monitor
      // holding only HEALTH_TOKEN, and Prisma/pg connection errors embed the
      // datasource host, port, database name and often the username
      // ("Can't reach database server at ep-xxx.neon.tech:5432"). The real
      // error goes to the log, where it is already access-controlled.
      logger.error({ err }, 'Deep health: database round-trip failed');
      checks.db = { status: 'critical', detail: 'database round-trip failed' };
    }
  }

  checks.campaignWorker = tickCheck('campaign worker', lastCampaignTickAt());
  checks.followupScheduler = tickCheck('follow-up scheduler', lastFollowupTickAt());

  // Mailbox health: an INACTIVE mailbox means token refresh hit a terminal
  // error (revoked/invalid secret) and sends through it are dead until the
  // user reconnects — exactly the failure that has bitten twice before.
  if (config.DATABASE_URL && checks.db.status === 'ok') {
    try {
      const [active, inactive] = await Promise.all([
        prisma.mailbox.count({ where: { isActive: true } }),
        prisma.mailbox.count({ where: { isActive: false } }),
      ]);
      checks.mailboxes =
        inactive > 0
          ? { status: 'degraded', detail: `${inactive} mailbox(es) deactivated (reconnect required), ${active} active` }
          : active === 0
            ? { status: 'degraded', detail: 'no connected mailboxes' }
            : { status: 'ok', detail: `${active} active` };
    } catch (err) {
      // Generic for the same reason the db check above is: a Prisma/pg error
      // embeds the datasource host, port, database and often the username, and
      // this payload is readable by anything holding HEALTH_TOKEN. The db check
      // was sanitized previously; this sibling was left echoing err.message.
      logger.error({ err }, 'Deep health: mailbox lookup failed');
      checks.mailboxes = { status: 'degraded', detail: 'mailbox lookup failed' };
    }
  } else {
    checks.mailboxes = { status: 'disabled', detail: 'db unavailable' };
  }

  // Disk space on the drive this process runs from (logs, dist, backups).
  try {
    const stat = fs.statfsSync(process.cwd());
    const free = stat.bavail * stat.bsize;
    checks.disk =
      free < DISK_MIN_FREE_BYTES
        ? { status: 'degraded', detail: `${Math.round(free / 1024 / 1024)} MB free (low)` }
        : { status: 'ok', detail: `${Math.round(free / 1024 / 1024 / 1024)} GB free` };
  } catch {
    checks.disk = { status: 'disabled', detail: 'statfs unavailable' };
  }

  checks.alerting = smtpFallbackConfigured()
    ? { status: 'ok', detail: config.ALERT_EMAIL ? 'SMTP fallback + ALERT_EMAIL configured' : 'SMTP fallback set, ALERT_EMAIL unset' }
    : { status: 'degraded', detail: 'PORTAL_SMTP_* unset — no fallback email or alerts' };

  // ── Send-capacity checks ───────────────────────────────────────────────────
  //
  // Everything that stops this system sending fails QUIETLY by design: the tier
  // cap releases the recipient and breaks the tick, an exhausted mailbox throws
  // a sentinel the worker treats as "no capacity", a missing postal address
  // blocks dispatch. All three log a warning nobody reads and leave the UI
  // showing an ACTIVE campaign that is simply not moving. These checks are the
  // difference between "we noticed at 09:05" and "we noticed on Thursday".
  if (config.DATABASE_URL && checks.db.status === 'ok') {
    checks.emailQuota = await quotaCheck();
    checks.sendCapacity = await sendCapacityCheck();
  } else {
    checks.emailQuota = { status: 'disabled', detail: 'db unavailable' };
    checks.sendCapacity = { status: 'disabled', detail: 'db unavailable' };
  }

  checks.backups = backupCheck();

  // Not a pass/fail check — an explanation. Without it, "last tick 21953s ago"
  // reads as a dead worker whether the cause is a crash or a deliberate sleep.
  const pulse = pulseState();
  checks.pulse = {
    status: 'ok',
    detail:
      pulse.mode === 'active'
        ? 'active — polling at full cadence'
        : `idle — database polling suspended so the compute can scale to zero; next wake in ${Math.round(pulse.msToNextWake / 1000)}s`,
  };

  const statuses = Object.values(checks).map((c) => c.status);
  const status = statuses.includes('critical') ? 'critical' : statuses.includes('degraded') ? 'degraded' : 'ok';
  return { status, at: new Date().toISOString(), checks };
}

/**
 * Tenant email quota against the tier cap.
 *
 * Warns at 80% rather than only at the wall, because the wall is a hard 402 in
 * the middle of a campaign and there is no self-serve way to raise a tier —
 * fixing it needs someone to act, so the warning has to arrive before sending
 * stops, not with it.
 */
async function quotaCheck(): Promise<HealthCheck> {
  try {
    const periodStart = utcMonthStart();
    // FREE tenants bucket by calendar month; paid tenants by their Stripe
    // anchor. Only the calendar-month bucket is checked here: it is the one
    // every current tenant uses, and a per-tenant sweep would be a query per
    // tenant per 15 minutes for a number that changes slowly.
    const worst = await prisma.$queryRaw<Array<{ email: string; tier: string; used: number }>>`
      SELECT u."email", u."tier"::text AS tier, COALESCE(r."emailsSent", 0)::int AS used
      FROM "User" u
      LEFT JOIN "UsageRecord" r
        ON r."userId" = u."id" AND r."periodStart" = ${periodStart}
      WHERE u."status" = 'ACTIVE'
      ORDER BY COALESCE(r."emailsSent", 0) DESC
      LIMIT 1`;

    if (worst.length === 0) return { status: 'ok', detail: 'no active tenants' };

    const { tier, used } = worst[0];
    const limit = TIER_EMAIL_LIMITS[tier as keyof typeof TIER_EMAIL_LIMITS] ?? TIER_EMAIL_LIMITS.FREE;
    const pct = Math.round((used / limit) * 100);

    if (used >= limit) {
      return { status: 'critical', detail: `tier email cap reached (${used}/${limit} on ${tier}) — sending is blocked` };
    }
    if (pct >= 80) {
      return { status: 'degraded', detail: `${pct}% of the ${tier} email cap used (${used}/${limit})` };
    }
    return { status: 'ok', detail: `${used}/${limit} this cycle (${tier})` };
  } catch (err) {
    logger.error({ err }, 'Deep health: quota check failed');
    return { status: 'degraded', detail: 'quota lookup failed' };
  }
}

/**
 * Can we actually send right now?
 *
 * Two separate ways to be stuck, both silent:
 *  - every active mailbox is at its daily warm-up cap (dailyLimit), or is
 *    unwarmed at dailyLimit 0 — the worker calls this "no capacity this tick"
 *    and moves on forever;
 *  - a campaign is ACTIVE but parked on a pausedReason, which today includes
 *    the new MISSING_SENDER_IDENTITY block and the bounce-rate auto-pause.
 */
async function sendCapacityCheck(): Promise<HealthCheck> {
  try {
    const today = utcDayStart();
    const [mailboxes, blocked] = await Promise.all([
      prisma.mailbox.findMany({
        where: { isActive: true },
        select: { dailyLimit: true, sentToday: true, counterDate: true },
      }),
      prisma.campaign.findMany({
        where: { status: 'ACTIVE', pausedReason: { not: null } },
        select: { name: true, pausedReason: true },
        take: 5,
      }),
    ]);

    if (blocked.length > 0) {
      const first = blocked[0];
      return {
        status: 'degraded',
        detail: `${blocked.length} active campaign(s) blocked — e.g. "${first.name}": ${first.pausedReason}`,
      };
    }

    if (mailboxes.length === 0) return { status: 'degraded', detail: 'no active mailboxes' };

    const withHeadroom = mailboxes.filter((m) => {
      // A counterDate before today means the counter has rolled and sentToday
      // is stale — the same rule pickRotationMailbox applies, restated here
      // rather than imported to keep the health check free of side effects.
      const sent = m.counterDate.getTime() < today.getTime() ? 0 : m.sentToday;
      return m.dailyLimit > 0 && sent < m.dailyLimit;
    });

    if (withHeadroom.length === 0) {
      const unwarmed = mailboxes.filter((m) => m.dailyLimit <= 0).length;
      return {
        status: 'degraded',
        detail: unwarmed === mailboxes.length
          ? `all ${mailboxes.length} mailbox(es) have dailyLimit 0 (unwarmed) — nothing can send`
          : `all ${mailboxes.length} mailbox(es) at their daily send cap`,
      };
    }

    const headroom = withHeadroom.reduce(
      (n, m) => n + (m.dailyLimit - (m.counterDate.getTime() < today.getTime() ? 0 : m.sentToday)),
      0,
    );
    return { status: 'ok', detail: `${headroom} send(s) of headroom across ${withHeadroom.length} mailbox(es)` };
  } catch (err) {
    logger.error({ err }, 'Deep health: send-capacity check failed');
    return { status: 'degraded', detail: 'send-capacity lookup failed' };
  }
}

/**
 * Is the daily backup actually producing files?
 *
 * This check exists because the scheduled backup reported success for a full
 * day while writing no scraper archive at all (a GNU-only tar flag against
 * Windows' bsdtar, with the error going to a discarded stdout). The task's own
 * exit code said 0. Nothing but looking at the output directory could have
 * caught it — so that is what this does.
 *
 * 26h, not 24h: the task runs at 03:00, and a check at 02:59 the next day is
 * not evidence of failure.
 */
function backupCheck(): HealthCheck {
  const dir = process.env.BACKUP_DIR || 'C:\\backups\\ysx';
  try {
    if (!fs.existsSync(dir)) return { status: 'degraded', detail: `backup directory ${dir} does not exist` };

    const files = fs.readdirSync(dir);
    const newest = (re: RegExp): number => {
      let best = 0;
      for (const f of files) {
        if (!re.test(f)) continue;
        const mtime = fs.statSync(path.join(dir, f)).mtimeMs;
        if (mtime > best) best = mtime;
      }
      return best;
    };

    const dbAge = newest(/^ysx-\d{4}-\d{2}-\d{2}\.(dump|json\.gz)$/);
    const scraperAge = newest(/^ysx-scraper-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
    const MAX_AGE_MS = 26 * 60 * 60_000;
    const now = Date.now();

    const stale: string[] = [];
    if (dbAge === 0) stale.push('no database dump found');
    else if (now - dbAge > MAX_AGE_MS) stale.push(`database dump is ${Math.round((now - dbAge) / 3_600_000)}h old`);

    // Checked SEPARATELY from the database dump, because the exact failure this
    // guards against is one half succeeding while the other silently does not.
    if (scraperAge === 0) stale.push('no scraper archive found');
    else if (now - scraperAge > MAX_AGE_MS) stale.push(`scraper archive is ${Math.round((now - scraperAge) / 3_600_000)}h old`);

    // The sharp signal: both artifacts are written by ONE script run, seconds
    // apart. So a scraper archive materially older than the database dump does
    // not mean "a bit stale" — it means the last run wrote one half and not the
    // other, which is precisely the bug that hid for a day behind exit code 0.
    //
    // Checking the two against each other catches it within minutes of the
    // 03:00 run; the absolute-age rule above would not have complained until
    // 05:00 the following day.
    const SKEW_MS = 2 * 60 * 60_000;
    if (dbAge > 0 && scraperAge > 0 && dbAge - scraperAge > SKEW_MS) {
      stale.push(
        `last backup run wrote the database dump but NOT the scraper archive ` +
          `(archive is ${Math.round((dbAge - scraperAge) / 3_600_000)}h older)`,
      );
    }

    if (stale.length > 0) return { status: 'degraded', detail: stale.join('; ') };
    return { status: 'ok', detail: 'database dump and scraper archive both fresh' };
  } catch (err) {
    logger.error({ err }, 'Deep health: backup check failed');
    return { status: 'degraded', detail: 'backup directory unreadable' };
  }
}

function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// ── Watchdog ────────────────────────────────────────────────────────────────
// Emails ALERT_EMAIL when a check newly fails (and when it recovers), at most
// once per check per ALERT_THROTTLE_MS. Uses the plain-SMTP fallback directly,
// NOT the OAuth mailbox — the mailbox being broken is a thing we alert about.

const ALERT_THROTTLE_MS = 6 * 60 * 60_000;

interface AlertState {
  failing: boolean;
  lastAlertAt: number;
}
const alertState = new Map<string, AlertState>();

function canAlert(): boolean {
  return Boolean(config.ALERT_EMAIL) && smtpFallbackConfigured();
}

async function sendAlert(subject: string, text: string): Promise<void> {
  try {
    await sendViaFallbackSmtp({ to: config.ALERT_EMAIL!, subject: `[YSX watchdog] ${subject}`, text });
  } catch (err) {
    logger.error({ err }, 'Watchdog alert email failed');
  }
}

/**
 * One watchdog pass. Exported for tests; alerting decisions (edge-triggered +
 * throttled) live here so tests can drive them with injected check results.
 */
export async function watchdogPassWith(health: DeepHealth, now = Date.now()): Promise<string[]> {
  const actions: string[] = [];
  for (const [name, check] of Object.entries(health.checks)) {
    const bad = check.status === 'critical' || check.status === 'degraded';
    const prev = alertState.get(name) ?? { failing: false, lastAlertAt: 0 };

    if (bad && (!prev.failing || now - prev.lastAlertAt >= ALERT_THROTTLE_MS)) {
      actions.push(`alert:${name}`);
      alertState.set(name, { failing: true, lastAlertAt: now });
      logger.warn({ check: name, status: check.status, detail: check.detail }, 'Watchdog: check failing');
      if (canAlert()) await sendAlert(`${name} ${check.status}`, `${name}: ${check.detail}\n\nFull status: ${health.status} at ${health.at}`);
    } else if (bad) {
      alertState.set(name, { ...prev, failing: true });
    } else if (prev.failing) {
      actions.push(`recovered:${name}`);
      alertState.set(name, { failing: false, lastAlertAt: prev.lastAlertAt });
      logger.info({ check: name }, 'Watchdog: check recovered');
      if (canAlert()) await sendAlert(`${name} recovered`, `${name} is healthy again: ${check.detail}`);
    }
  }
  return actions;
}

let watchdogStarted = false;

export function startWatchdog(options?: { intervalMs?: number }): void {
  if (watchdogStarted) return;
  if (!workersEnabled()) {
    logger.warn('Watchdog not started (no DATABASE_URL or test env)');
    return;
  }
  watchdogStarted = true;
  const intervalMs = options?.intervalMs ?? 15 * 60_000;

  // The watchdog queries the database too (db round-trip, mailbox counts,
  // quota, capacity). Left ungated at 15 minutes it would keep the compute alive
  // by itself and undo the back-off entirely, so it takes its turn in the same
  // burst as everything else. Detection latency for a genuine failure becomes
  // one idle interval, which is the trade being made.
  //
  // MUST go through startGatedPoller, not a gated 15-minute setInterval. The
  // watchdog's period is an exact multiple of the idle wake interval, so its
  // ticks landed on two fixed points per cycle and — measured over 14 simulated
  // idle days — hit the 90-second burst window at NO boot phase tried. It was
  // therefore silently dead exactly when the system was idle, which is precisely
  // when an unnoticed failure needs alerting. The alerting whose first real
  // delivery the 2026-07-28 outage demonstrated would have shipped switched off.
  //
  // First pass is delayed one interval: workers need time for their first tick.
  startGatedPoller({
    name: 'watchdog',
    intervalMs,
    run: async () => {
      await watchdogPassWith(await runDeepChecks());
    },
  });
  logger.info({ intervalMs, alerting: canAlert() }, 'Watchdog started');
}
