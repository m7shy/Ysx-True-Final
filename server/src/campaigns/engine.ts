import { RecipientStatus, type Campaign, type Mailbox } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { pickRotationMailbox } from '../creds/mailboxStore.js';
import { cancelRemainingFollowupsForRecipient } from '../scheduler/followupScheduler.js';

/**
 * Pure/stateless helpers for the campaign worker (worker.ts). Split out so
 * the scheduling logic (send windows, retry backoff, mailbox selection) can
 * be unit-tested without a database.
 */

// ── Send window ──────────────────────────────────────────────────────────────

const DAY_BIT: Record<string, number> = {
  Mon: 1 << 0,
  Tue: 1 << 1,
  Wed: 1 << 2,
  Thu: 1 << 3,
  Fri: 1 << 4,
  Sat: 1 << 5,
  Sun: 1 << 6,
};

/** Minutes since local midnight + day-of-week bit, resolved in the given IANA timezone. */
function localClock(now: Date, timezone: string): { minutesOfDay: number; dayBit: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  // Intl can render midnight hour as "24" in hour12:false mode; normalize.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    minutesOfDay: hour * 60 + minute,
    dayBit: DAY_BIT[weekday] ?? 0,
  };
}

export interface SendWindowCampaign {
  sendWindowStart: number | null;
  sendWindowEnd: number | null;
  sendDays: number | null;
  timezone: string | null;
}

/**
 * Whether a campaign is allowed to send right now. All three controls
 * (days, window, timezone) are optional/nullable — a campaign with none set
 * is unrestricted (matches pre-Phase-2 behavior: sends 24/7).
 */
export function isWithinSendWindow(campaign: SendWindowCampaign, now: Date = new Date()): boolean {
  if (campaign.sendWindowStart == null && campaign.sendWindowEnd == null && campaign.sendDays == null) {
    return true;
  }

  const timezone = campaign.timezone || 'UTC';
  let clock: { minutesOfDay: number; dayBit: number };
  try {
    clock = localClock(now, timezone);
  } catch {
    // Invalid/unknown timezone string — fail open rather than silently
    // blocking every send (route validation should prevent this anyway).
    clock = localClock(now, 'UTC');
  }

  if (campaign.sendDays != null && (campaign.sendDays & clock.dayBit) === 0) {
    return false;
  }

  if (campaign.sendWindowStart != null && campaign.sendWindowEnd != null) {
    const { minutesOfDay } = clock;
    const { sendWindowStart: start, sendWindowEnd: end } = campaign;
    if (start === end) return true; // degenerate "full day" window
    if (start < end) {
      return minutesOfDay >= start && minutesOfDay < end;
    }
    // Overnight window, e.g. 22:00 -> 06:00.
    return minutesOfDay >= start || minutesOfDay < end;
  }

  return true;
}

// ── Retry backoff ────────────────────────────────────────────────────────────

// Attempt 1 fails -> retry in 5m; attempt 2 fails -> retry in 30m;
// attempt 3 fails -> retry in 2h; attempt 4 failing exhausts retries.
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
export const MAX_SEND_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * Backoff delay before the next retry given the attempt count that just
 * failed (1-indexed). Returns null once attempts are exhausted (caller
 * should terminally fail instead of retrying).
 */
export function computeNextRetryDelayMs(attemptCount: number): number | null {
  if (attemptCount >= MAX_SEND_ATTEMPTS) return null;
  return RETRY_BACKOFF_MS[Math.min(attemptCount - 1, RETRY_BACKOFF_MS.length - 1)];
}

/**
 * Errors that must NOT trigger a retry-with-backoff (they'll never succeed
 * on their own, or backing off would violate a hard business rule): the
 * tier email cap. LimitExceededError doesn't extend a shared base class
 * across billing/mail, so it's identified structurally.
 */
export function isLimitExceededError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as any).code === 'LIMIT_EXCEEDED';
}

/**
 * Hard (permanent) SMTP bounce: the standard 5xx "will never succeed" codes,
 * or a message body matching the common "no such mailbox" phrasing when the
 * relay doesn't surface a clean responseCode. Anything else (4xx, timeouts,
 * auth hiccups) is transient and goes through the normal retry backoff
 * instead — see worker.ts's dispatch catch block.
 */
const HARD_BOUNCE_CODES = new Set([550, 551, 553, 554]);
const HARD_BOUNCE_MESSAGE_RE = /user unknown|mailbox unavailable|mailbox not found|does not exist|no such user|recipient rejected/i;

export function isHardBounceError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const responseCode = (err as any).responseCode;
  if (typeof responseCode === 'number' && HARD_BOUNCE_CODES.has(responseCode)) return true;
  const message = err instanceof Error ? err.message : String((err as any).message ?? '');
  return HARD_BOUNCE_MESSAGE_RE.test(message);
}

/**
 * Soft bounce: a 4xx recipient-side rejection (mailbox full, over quota,
 * greylisting). Still retried like any transient error, but each occurrence
 * increments Lead.bounceCount; at SOFT_BOUNCE_THRESHOLD the lead flips
 * isBounced and stops being mailed — see worker.ts's dispatch catch block.
 * 421/450/451/452 are the RFC 5321 transient-failure codes; the message
 * regex catches relays that don't surface a clean responseCode.
 */
const SOFT_BOUNCE_CODES = new Set([421, 450, 451, 452]);
const SOFT_BOUNCE_MESSAGE_RE = /mailbox full|over quota|quota exceeded|insufficient (system )?storage|temporarily (deferred|unavailable|rejected)/i;

export const SOFT_BOUNCE_THRESHOLD = 3;

export function isSoftBounceError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (isHardBounceError(err)) return false;
  const responseCode = (err as any).responseCode;
  if (typeof responseCode === 'number' && SOFT_BOUNCE_CODES.has(responseCode)) return true;
  const message = err instanceof Error ? err.message : String((err as any).message ?? '');
  return SOFT_BOUNCE_MESSAGE_RE.test(message);
}

// ── Mailbox selection (honors Campaign.distributionMethod) ──────────────────

/**
 * INDIVIDUAL (default): least-recently-used mailbox under its daily limit —
 * spreads volume evenly, matches the pre-Phase-2 rotation behavior.
 *
 * GROUP ("Group Thread" in the UI): pin to the tenant's single primary
 * mailbox (earliest-connected, active, under its daily limit) instead of
 * rotating, so every recipient in a GROUP campaign is contacted from the
 * same consistent sending identity. If the primary mailbox is exhausted,
 * GROUP does not fall back to rotation (that would defeat the point of a
 * single consistent thread) — the campaign simply pauses until it resets.
 */
export async function pickMailbox(
  userId: string,
  distributionMethod: string | null,
): Promise<Mailbox | null> {
  if (distributionMethod === 'GROUP') {
    const today = new Date();
    const utcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const primary = await prisma.mailbox.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!primary) return null;
    const effectiveSentToday = primary.counterDate.getTime() < utcDay.getTime() ? 0 : primary.sentToday;
    if (primary.dailyLimit <= 0 || effectiveSentToday >= primary.dailyLimit) return null;
    return primary;
  }

  return pickRotationMailbox(userId);
}

// ── Per-campaign daily counter (mirrors Mailbox.sentToday/counterDate) ──────

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function effectiveCampaignSentToday(campaign: Pick<Campaign, 'sentToday' | 'counterDate'>, now: Date = new Date()): number {
  const today = utcDayStart(now);
  return campaign.counterDate.getTime() < today.getTime() ? 0 : campaign.sentToday;
}

/** Remaining sends allowed today under Campaign.dailyLimit (Infinity if unset). */
export function remainingDailyBudget(campaign: Pick<Campaign, 'dailyLimit' | 'sentToday' | 'counterDate'>, now: Date = new Date()): number {
  if (campaign.dailyLimit == null) return Infinity;
  return Math.max(0, campaign.dailyLimit - effectiveCampaignSentToday(campaign, now));
}

// ── Stop on open/click ───────────────────────────────────────────────────────

/**
 * Called from the (unauthenticated) tracking pixel/redirect endpoints when an
 * OPENED or CLICKED event fires. If the owning campaign opted into
 * stopOnOpen/stopOnClick, completes the recipient's in-flight sequence —
 * mirrors replyPoller.ts's stopOnReply handling.
 */
export async function stopRecipientForEvent(recipientId: string, eventType: 'OPENED' | 'CLICKED'): Promise<void> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: { select: { id: true, stopOnClick: true, stopOnOpen: true } } },
  });
  if (!recipient) return;
  if (!(recipient.status === RecipientStatus.PENDING || recipient.status === RecipientStatus.IN_SEQUENCE)) return;

  const shouldStop =
    (eventType === 'OPENED' && recipient.campaign.stopOnOpen) ||
    (eventType === 'CLICKED' && recipient.campaign.stopOnClick);
  if (!shouldStop) return;

  const lead = await prisma.lead.findUnique({ where: { id: recipient.leadId }, select: { email: true } });

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: RecipientStatus.COMPLETED },
  });

  if (lead) {
    await cancelRemainingFollowupsForRecipient(recipient.campaignId, lead.email, `stop_on_${eventType.toLowerCase()}`);
  }

  logger.info({ recipientId, campaignId: recipient.campaignId, eventType }, 'Recipient sequence stopped by tracking event');
}
