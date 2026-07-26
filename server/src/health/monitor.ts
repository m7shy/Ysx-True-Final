import fs from 'node:fs';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { lastCampaignTickAt } from '../campaigns/worker.js';
import { lastFollowupTickAt } from '../scheduler/followupScheduler.js';
import { smtpFallbackConfigured, sendViaFallbackSmtp } from '../portal/mailer.js';

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

  const statuses = Object.values(checks).map((c) => c.status);
  const status = statuses.includes('critical') ? 'critical' : statuses.includes('degraded') ? 'degraded' : 'ok';
  return { status, at: new Date().toISOString(), checks };
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

  const run = async () => {
    try {
      await watchdogPassWith(await runDeepChecks());
    } catch (err) {
      logger.error({ err }, 'Watchdog pass failed');
    }
  };
  // First pass delayed one interval: workers need time for their first tick.
  setInterval(run, intervalMs);
  logger.info({ intervalMs, alerting: canAlert() }, 'Watchdog started');
}
