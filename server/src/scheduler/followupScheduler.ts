import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { logger } from "../logger.js";
import type { FollowupJob, FollowupJobInput, FollowupStatus } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/scheduler -> ../../data = server/data
// server/dist/scheduler -> ../../data = server/data
const DATA_DIR = path.resolve(__dirname, "../../data");
const STORE_FILE = path.join(DATA_DIR, "followups.json");
const TEMP_FILE = path.join(DATA_DIR, "followups.tmp.json");

const jobs = new Map<string, FollowupJob>();

let loaded = false;
let started = false;
let ticking = false;

// serialize all store mutations + persists (prevents API vs tick races)
let storeLock: Promise<void> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeLock.then(fn, fn);
  storeLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function isValidStatus(value: unknown): value is FollowupStatus {
  return (
    value === "scheduled" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidJob(candidate: unknown): candidate is FollowupJob {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;

  if (!isNonEmptyString(obj.id)) return false;
  if (!isNonEmptyString(obj.provider)) return false;
  if (!isNonEmptyString(obj.to)) return false;
  if (!isNonEmptyString(obj.subject)) return false;
  if (!isNonEmptyString(obj.body)) return false;
  if (!isNonEmptyString(obj.scheduledAt)) return false;
  if (!isNonEmptyString(obj.createdAt)) return false;
  if (!isValidStatus(obj.status)) return false;

  // Optional string fields – when present must be strings
  const maybeStringKeys: (keyof FollowupJob)[] = [
    "replyTo",
    "html",
    "lastError",
    "failureReason",
    "cancelReason",
    "campaignId",
    "leadId",
    "originalEmailId",
    "originalMessageId",
    "initialSentAt",
    "recipientEmail",
    "updatedAt",
    "sentAt",
  ];

  for (const key of maybeStringKeys) {
    const value = (obj as any)[key];
    if (value != null && typeof value !== "string") {
      return false;
    }
  }

  return true;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function persist(): Promise<void> {
  await ensureDataDir();
  const payload = JSON.stringify(Array.from(jobs.values()), null, 2);
  await fs.writeFile(TEMP_FILE, payload, "utf8");
  await fs.rename(TEMP_FILE, STORE_FILE);
}

async function loadOnce(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      let kept = 0;
      for (const item of parsed) {
        if (isValidJob(item)) {
          const job = item as FollowupJob;
          jobs.set(job.id, job);
          kept += 1;
        }
      }

      if (kept !== parsed.length) {
        logger.warn({ parsed: parsed.length, kept }, "Filtered invalid follow-up jobs on load");
      }
    } else {
      logger.warn("followups.json was not an array; starting with empty store");
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      logger.warn({ err }, "Failed to load followups.json, starting with empty store");
    }
  }
}

function isDue(job: FollowupJob, nowMs: number): boolean {
  if (job.status !== "scheduled") return false;
  const when = new Date(job.scheduledAt).getTime();
  if (Number.isNaN(when)) return false;
  return when <= nowMs;
}

async function setStatus(
  job: FollowupJob,
  status: FollowupStatus,
  extra: Partial<FollowupJob> = {},
): Promise<void> {
  job.status = status;
  Object.assign(job, extra);
  job.updatedAt = new Date().toISOString();
  await persist();
}

export async function scheduleFollowup(input: FollowupJobInput): Promise<FollowupJob> {
  return withStoreLock(async () => {
    await loadOnce();

    const scheduledTime = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledTime.getTime())) {
      throw new Error("scheduledAt must be a valid ISO timestamp");
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

    const nowIso = new Date().toISOString();

    const job: FollowupJob = {
      ...input,
      id: randomUUID(),
      recipientEmail,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: "scheduled",
      lastError: undefined,
      failureReason: undefined,
      cancelReason: undefined,
    };

    jobs.set(job.id, job);
    await persist();

    logger.info(
      {
        id: job.id,
        to: job.to,
        subject: job.subject,
        campaignId: job.campaignId,
        recipientEmail: job.recipientEmail,
        scheduledAt: job.scheduledAt,
        skipIfReplied: job.skipIfReplied,
      },
      "Scheduled follow-up job",
    );

    return job;
  });
}

export async function getScheduledFollowups(): Promise<FollowupJob[]> {
  return withStoreLock(async () => {
    await loadOnce();
    return Array.from(jobs.values());
  });
}

export async function cancelFollowup(
  id: string,
  reason: string = "cancelled",
): Promise<boolean> {
  return withStoreLock(async () => {
    await loadOnce();

    const job = jobs.get(id);
    if (!job) return false;

    if (job.status === "sent" || job.status === "cancelled") {
      return true;
    }

    job.cancelReason = reason;
    job.lastError = reason;
    job.failureReason = reason;
    await setStatus(job, "cancelled");

    logger.info(
      { id: job.id, to: job.to, subject: job.subject, cancelReason: reason },
      "Cancelled follow-up job",
    );

    return true;
  });
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

  await withStoreLock(async () => {
    await loadOnce();

    let changed = false;
    for (const job of jobs.values()) {
      if (
        job.id !== excludeJobId &&
        job.campaignId === campaignId &&
        (job.recipientEmail ?? "").trim().toLowerCase() === normalizedRecipient &&
        job.status === "scheduled"
      ) {
        job.cancelReason = reason;
        job.lastError = reason;
        job.failureReason = reason;
        job.status = "cancelled";
        job.updatedAt = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      await persist();
    }
  });
}

/**
 * Single scheduler tick: marks due jobs as "sending" and persists BEFORE
 * actually calling `onSend`. Sending and final status updates happen outside
 * the store lock to avoid deadlocks.
 */
export async function tickOnce(
  onSend: (job: FollowupJob) => Promise<void>,
): Promise<void> {
  if (ticking) return;
  ticking = true;

  try {
    const now = Date.now();

    // Mark due jobs as sending under lock and take a snapshot to send.
    const toSend: FollowupJob[] = await withStoreLock(async () => {
      await loadOnce();

      const dueJobs: FollowupJob[] = [];
      for (const job of jobs.values()) {
        if (isDue(job, now)) {
          job.status = "sending";
          job.lastError = undefined;
          job.failureReason = undefined;
          job.updatedAt = new Date().toISOString();
          dueJobs.push({ ...job });
        }
      }

      if (dueJobs.length > 0) {
        await persist();
      }

      return dueJobs;
    });

    for (const job of toSend) {
      try {
        await onSend(job);

        // If onSend decided the outcome (cancelled / failed / sent),
        // do not overwrite it.
        await withStoreLock(async () => {
          await loadOnce();
          const current = jobs.get(job.id);
          if (!current || current.status !== "sending") return;

          current.status = "sent";
          current.sentAt = new Date().toISOString();
          current.updatedAt = current.sentAt;
          current.lastError = undefined;
          current.failureReason = undefined;
          await persist();
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await withStoreLock(async () => {
          await loadOnce();
          const current = jobs.get(job.id);
          if (!current) return;

          current.status = "failed";
          current.updatedAt = new Date().toISOString();
          current.lastError = message;
          current.failureReason = message;
          await persist();
        });

        logger.error(
          { err, id: job.id, to: job.to, subject: job.subject },
          "Follow-up job failed",
        );
      }
    }
  } finally {
    ticking = false;
  }
}

export function startFollowupScheduler(
  onSend: (job: FollowupJob) => Promise<void>,
  options?: { tickMs?: number },
): void {
  if (started) return;
  started = true;

  const intervalMs =
    options?.tickMs && options.tickMs > 0 ? options.tickMs : 10_000;

  void loadOnce()
    .then(() => tickOnce(onSend))
    .catch((err) => logger.error({ err }, "Initial follow-up tick failed"));

  setInterval(() => {
    void tickOnce(onSend).catch((err) =>
      logger.error({ err }, "Follow-up scheduler tick failed"),
    );
  }, intervalMs);
}
