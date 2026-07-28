import { FollowupJobStatus, type FollowupJob as DbFollowupJob } from "@prisma/client";

import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { mayPoll } from "./pulse.js";
import { MailError } from "../httpErrors.js";
import { computeNextRetryDelayMs } from "../campaigns/engine.js";
import type { FollowupJob, FollowupJobInput, FollowupStatus, ProviderKey } from "./types.js";

/**
 * Follow-up scheduler, backed by the Prisma `FollowupJob` table.
 *
 * Replaces the legacy server/data/followups.json store: jobs are now durable
 * across deploys, tenant-owned (userId FK with cascade delete), and every
 * read/cancel path is bounded by the owning tenant.
 *
 * The exported API and the ISO-string `FollowupJob` shape (scheduler/types.ts)
 * are unchanged, so routes, the campaign worker, and the reply poller keep
 * working as before.
 */

// ── DB row <-> API shape mapping ─────────────────────────────────────────────

const STATUS_TO_API: Record<FollowupJobStatus, FollowupStatus> = {
  [FollowupJobStatus.SCHEDULED]: "scheduled",
  [FollowupJobStatus.SENDING]: "sending",
  [FollowupJobStatus.SENT]: "sent",
  [FollowupJobStatus.FAILED]: "failed",
  [FollowupJobStatus.CANCELLED]: "cancelled",
};

function toApiJob(row: DbFollowupJob): FollowupJob {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as ProviderKey,
    to: row.to,
    subject: row.subject,
    body: row.body,
    html: row.html ?? undefined,
    replyTo: row.replyTo ?? undefined,
    scheduledAt: row.scheduledAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: row.sentAt?.toISOString(),
    status: STATUS_TO_API[row.status],
    lastError: row.lastError ?? undefined,
    failureReason: row.failureReason ?? undefined,
    cancelReason: row.cancelReason ?? undefined,
    campaignId: row.campaignId ?? undefined,
    leadId: row.leadId ?? undefined,
    originalEmailId: row.originalEmailId ?? undefined,
    stepIndex: row.stepIndex ?? undefined,
    onlyIfNoReply: row.onlyIfNoReply,
    skipIfReplied: row.skipIfReplied,
    originalMessageId: row.originalMessageId ?? undefined,
    initialSentAt: row.initialSentAt?.toISOString(),
    recipientEmail: row.recipientEmail ?? undefined,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scheduleFollowup(input: FollowupJobInput): Promise<FollowupJob> {
  const scheduledTime = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledTime.getTime())) {
    throw new Error("scheduledAt must be a valid ISO timestamp");
  }

  if (!input.userId) {
    throw new Error("userId is required");
  }

  if (!input.campaignId) {
    throw new Error("campaignId is required");
  }

  const recipientRaw = (input.recipientEmail ?? input.to ?? "").trim();
  if (!recipientRaw) {
    throw new Error("recipientEmail is required");
  }
  const recipientEmail = recipientRaw.toLowerCase();

  if (!input.initialSentAt) {
    throw new Error("initialSentAt is required");
  }
  const initialSent = new Date(input.initialSentAt);
  if (Number.isNaN(initialSent.getTime())) {
    throw new Error("initialSentAt must be a valid ISO timestamp");
  }

  const row = await prisma.followupJob.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      to: input.to,
      subject: input.subject,
      body: input.body,
      html: input.html,
      replyTo: input.replyTo,
      scheduledAt: scheduledTime,
      status: FollowupJobStatus.SCHEDULED,
      campaignId: input.campaignId,
      leadId: input.leadId,
      originalEmailId: input.originalEmailId,
      stepIndex: input.stepIndex,
      onlyIfNoReply: input.onlyIfNoReply ?? false,
      skipIfReplied: input.skipIfReplied ?? false,
      originalMessageId: input.originalMessageId,
      initialSentAt: initialSent,
      recipientEmail,
    },
  });

  logger.info(
    {
      id: row.id,
      userId: row.userId,
      to: row.to,
      subject: row.subject,
      campaignId: row.campaignId,
      recipientEmail: row.recipientEmail,
      scheduledAt: row.scheduledAt.toISOString(),
      skipIfReplied: row.skipIfReplied,
    },
    "Scheduled follow-up job",
  );

  return toApiJob(row);
}

/**
 * List follow-up jobs. Pass the authenticated tenant's userId to get only that
 * tenant's jobs; calling without a userId returns all jobs and is reserved for
 * internal/diagnostic use.
 */
export async function getScheduledFollowups(userId?: string): Promise<FollowupJob[]> {
  const rows = await prisma.followupJob.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map(toApiJob);
}

/**
 * Cancel a job. When `userId` is provided the cancel is tenant-bounded: a job
 * belonging to another tenant is treated as not found.
 */
export async function cancelFollowup(
  id: string,
  reason: string = "cancelled",
  userId?: string,
): Promise<boolean> {
  const job = await prisma.followupJob.findFirst({
    where: { id, ...(userId ? { userId } : {}) },
  });
  if (!job) return false;

  if (job.status === FollowupJobStatus.SENT || job.status === FollowupJobStatus.CANCELLED) {
    return true;
  }

  await prisma.followupJob.update({
    where: { id: job.id },
    data: {
      status: FollowupJobStatus.CANCELLED,
      cancelReason: reason,
      lastError: reason,
      failureReason: reason,
    },
  });

  logger.info(
    { id: job.id, to: job.to, subject: job.subject, cancelReason: reason },
    "Cancelled follow-up job",
  );

  return true;
}

/**
 * Cancel all remaining (still scheduled) followups for the same
 * (campaignId, recipientEmail) pair.
 */
export async function cancelRemainingFollowupsForRecipient(
  campaignId: string,
  recipientEmail: string,
  reason: string = "replied",
  excludeJobId?: string,
): Promise<void> {
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  if (!campaignId || !normalizedRecipient) return;

  await prisma.followupJob.updateMany({
    where: {
      campaignId,
      recipientEmail: normalizedRecipient,
      status: FollowupJobStatus.SCHEDULED,
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
    data: {
      status: FollowupJobStatus.CANCELLED,
      cancelReason: reason,
      lastError: reason,
      failureReason: reason,
    },
  });
}

/**
 * Cancel all remaining (still scheduled) followups for a given campaign.
 */
export async function cancelScheduledFollowupsForCampaign(
  campaignId: string,
  reason: string = "campaign_paused",
): Promise<void> {
  if (!campaignId) return;

  await prisma.followupJob.updateMany({
    where: {
      campaignId,
      status: FollowupJobStatus.SCHEDULED,
    },
    data: {
      status: FollowupJobStatus.CANCELLED,
      cancelReason: reason,
      lastError: reason,
      failureReason: reason,
    },
  });
}


/**
 * Cancel every still-scheduled followup a tenant has queued for a recipient,
 * across all campaigns (used by the reply poller when an inbound reply is
 * detected). Returns the distinct campaignIds whose sequences were touched.
 */
export async function cancelScheduledFollowupsForUserRecipient(
  userId: string,
  recipientEmail: string,
  reason: string = "replied",
): Promise<string[]> {
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  if (!userId || !normalizedRecipient) return [];

  const where = {
    userId,
    recipientEmail: normalizedRecipient,
    status: FollowupJobStatus.SCHEDULED,
  };

  const affected = await prisma.followupJob.findMany({
    where,
    select: { campaignId: true },
  });
  if (affected.length === 0) return [];

  await prisma.followupJob.updateMany({
    where,
    data: {
      status: FollowupJobStatus.CANCELLED,
      cancelReason: reason,
      lastError: reason,
      failureReason: reason,
    },
  });

  const campaignIds = new Set<string>();
  for (const row of affected) {
    if (row.campaignId) campaignIds.add(row.campaignId);
  }
  return Array.from(campaignIds);
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

let started = false;
let ticking = false;

// A job claimed to SENDING (see the compare-and-set below) has no in-process
// finally{} left to release it if the process dies mid-send — it would
// otherwise stay SENDING forever, which reads to the tenant as a silently
// dropped follow-up. `updatedAt` is bumped by the claim itself (SCHEDULED ->
// SENDING), so a SENDING row whose updatedAt is older than this timeout is
// treated as stranded and put back to SCHEDULED for the next tick to reclaim.
// Mirrors scraper/autoScheduler.ts's recoverStaleRuns() for the same failure
// mode, sized down since a mail send should resolve in seconds, not minutes.
const STALE_SENDING_TIMEOUT_MS = 10 * 60_000;

/** Reset any SENDING job stuck past the stale-claim timeout back to SCHEDULED. */
async function recoverStaleSendingJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_TIMEOUT_MS);
  const stale = await prisma.followupJob.findMany({
    where: { status: FollowupJobStatus.SENDING, updatedAt: { lte: staleBefore } },
    select: { id: true, to: true, subject: true },
  });
  if (stale.length === 0) return;

  for (const job of stale) {
    const claimed = await prisma.followupJob.updateMany({
      where: { id: job.id, status: FollowupJobStatus.SENDING },
      data: {
        status: FollowupJobStatus.SCHEDULED,
        scheduledAt: new Date(),
        lastError: "Stranded in SENDING past timeout (process restart); recovered automatically.",
      },
    });
    if (claimed.count === 1) {
      logger.warn({ id: job.id, to: job.to, subject: job.subject }, "Recovered a stale SENDING follow-up job");
    }
  }
}

/**
 * Single scheduler tick: atomically claims due jobs (SCHEDULED -> SENDING) so
 * concurrent ticks / multiple instances never double-send, then runs `onSend`
 * for each claimed job outside any lock.
 */
export async function tickOnce(
  onSend: (job: FollowupJob) => Promise<void>,
): Promise<void> {
  if (ticking) return;
  ticking = true;

  try {
    await recoverStaleSendingJobs();

    const now = new Date();

    // Claim each due job individually with a guarded update: updateMany with a
    // status filter is the atomic compare-and-set; a row already claimed by a
    // concurrent worker matches 0 rows and is skipped.
    const due = await prisma.followupJob.findMany({
      where: { status: FollowupJobStatus.SCHEDULED, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" },
    });

    const toSend: DbFollowupJob[] = [];
    for (const job of due) {
      const claimed = await prisma.followupJob.updateMany({
        where: { id: job.id, status: FollowupJobStatus.SCHEDULED },
        data: {
          status: FollowupJobStatus.SENDING,
          lastError: null,
          failureReason: null,
        },
      });
      if (claimed.count === 1) toSend.push(job);
    }

    for (const row of toSend) {
      const job = toApiJob(row);
      job.status = "sending";

      try {
        await onSend(job);

        // If onSend decided the outcome (cancelled / failed / sent), do not
        // overwrite it: only a job still in SENDING is finalized as SENT.
        await prisma.followupJob.updateMany({
          where: { id: row.id, status: FollowupJobStatus.SENDING },
          data: {
            status: FollowupJobStatus.SENT,
            sentAt: new Date(),
            lastError: null,
            failureReason: null,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // A DENIED send (relay refused — bad/unauthorized From address) will
        // never succeed on retry; everything else (SMTP timeouts, transient
        // auth hiccups, tier-limit-reached) gets a backoff retry.
        const isPermanent = err instanceof MailError && err.code === "DENIED";
        const attemptCount = row.attemptCount + 1;
        const retryDelayMs = isPermanent ? null : computeNextRetryDelayMs(attemptCount);

        if (retryDelayMs === null) {
          await prisma.followupJob.updateMany({
            where: { id: row.id },
            data: {
              status: FollowupJobStatus.FAILED,
              attemptCount,
              lastError: message,
              failureReason: message,
            },
          });
          logger.error(
            { err, id: row.id, to: row.to, subject: row.subject, attemptCount },
            "Follow-up job failed permanently",
          );
        } else {
          const nextRetryAt = new Date(Date.now() + retryDelayMs);
          await prisma.followupJob.updateMany({
            where: { id: row.id },
            data: {
              status: FollowupJobStatus.SCHEDULED,
              scheduledAt: nextRetryAt,
              nextRetryAt,
              attemptCount,
              lastError: message,
            },
          });
          logger.warn(
            { err, id: row.id, to: row.to, subject: row.subject, attemptCount, nextRetryAt },
            "Follow-up job failed; retrying with backoff",
          );
        }
      }
    }
    lastTickAt = new Date();
  } finally {
    ticking = false;
  }
}

let lastTickAt: Date | null = null;

/** When the follow-up scheduler last completed a tick (null = never). For health checks. */
export function lastFollowupTickAt(): Date | null {
  return lastTickAt;
}

export function startFollowupScheduler(
  onSend: (job: FollowupJob) => Promise<void>,
  options?: { tickMs?: number },
): void {
  if (started) return;

  // The queue lives in Postgres now; without a database there is nothing to
  // tick (mail-only runs and the vitest suite import index.ts without a DB).
  if (!config.DATABASE_URL || config.NODE_ENV === "test") {
    logger.warn("Follow-up scheduler not started (no DATABASE_URL or test env)");
    return;
  }

  started = true;

  const intervalMs =
    options?.tickMs && options.tickMs > 0 ? options.tickMs : 10_000;

  void tickOnce(onSend).catch((err) =>
    logger.error({ err }, "Initial follow-up tick failed"),
  );

  setInterval(() => {
    // Idle gate. At 10s this was the single heaviest source of database
    // wake-ups in the process — ~8,640 queries a day to discover that an empty
    // queue is still empty.
    if (!mayPoll("followupScheduler")) return;
    void tickOnce(onSend).catch((err) =>
      logger.error({ err }, "Follow-up scheduler tick failed"),
    );
  }, intervalMs);
}
