import { CampaignStatus, FollowupJobStatus, LeadStatus, RecipientStatus, TrackingEventType, type Campaign, type CampaignRecipient, type Lead } from '@prisma/client';
import { randomInt } from 'node:crypto';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { maskEmail } from '../util/redact.js';
import { sendFromMailbox } from '../mail/smtpGateway.js';
import { recordMailboxSend } from '../creds/mailboxStore.js';
import { scheduleFollowup } from '../scheduler/followupScheduler.js';
import { resolveSpintax } from './spintax.js';
import { renderTemplate } from './variables.js';
import { buildTrackedEmail, unsubscribeHeaders } from './trackedHtml.js';
import {
  isWithinSendWindow,
  pickMailbox,
  remainingDailyBudget,
  computeNextRetryDelayMs,
  isLimitExceededError,
  isHardBounceError,
  isSoftBounceError,
  SOFT_BOUNCE_THRESHOLD,
} from './engine.js';

/**
 * Phase 2 outbound engine: each tick, dispatches ACTIVE campaigns against
 * their own CampaignRecipient rows (not the tenant's whole lead pool — see
 * CampaignRecipient model comment in schema.prisma for why that changed).
 *
 * Follow-up steps (Campaign.autoFollowUps) are NOT re-executed by this
 * worker: dispatchRecipient schedules them through the existing durable
 * FollowupJob queue (scheduler/followupScheduler.ts) exactly as before —
 * this worker only owns the *initial* send per recipient.
 */

// Max sends per campaign per tick — keeps a tick short and paces volume.
const BATCH_SIZE = Math.max(1, Number(process.env.CAMPAIGN_BATCH_SIZE ?? 10));

// Campaigns created before this migration landed have no CampaignRecipient
// rows (the old data model had none). For those — and ONLY those — the
// worker materializes recipients once from the tenant's NEW leads, matching
// the exact set that would have been targeted under the old behavior. Any
// campaign created after this cutoff with zero recipients was created that
// way deliberately (e.g. nothing selected in Compose) and is left alone —
// defaulting an empty recipient list to "every NEW lead" is the bug this
// migration fixes, not a fallback to preserve.
const LEGACY_RECIPIENT_CUTOFF = new Date('2026-07-10T12:12:35.460Z');

interface AutoFollowUp {
  delay: number;
  unit: string; // 'minutes' | 'hours' | 'days'
  content: string;
}

function followUpDelayMs(f: AutoFollowUp): number {
  const unit = String(f.unit ?? 'days').toLowerCase();
  const ms =
    unit.startsWith('minute') ? 60_000 :
    unit.startsWith('hour') ? 3_600_000 :
    86_400_000; // days (default)
  return Math.max(0, Number(f.delay) || 0) * ms;
}

function parseAutoFollowUps(raw: unknown): AutoFollowUp[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is AutoFollowUp =>
      !!f && typeof f === 'object' && typeof (f as any).content === 'string',
  );
}

/** One-time bridge: give a legacy campaign (see LEGACY_RECIPIENT_CUTOFF) its recipient rows. */
async function materializeLegacyRecipients(campaign: Campaign): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { userId: campaign.userId, status: LeadStatus.NEW },
    select: { id: true },
  });
  if (leads.length === 0) return;

  await prisma.campaignRecipient.createMany({
    data: leads.map((l) => ({
      campaignId: campaign.id,
      leadId: l.id,
      userId: campaign.userId,
      status: RecipientStatus.PENDING,
    })),
    skipDuplicates: true,
  });

  logger.info(
    { campaignId: campaign.id, count: leads.length },
    'Materialized legacy campaign recipients from tenant NEW leads',
  );
}

const NO_MAILBOX = Symbol('no-mailbox');

async function dispatchRecipient(
  campaign: Campaign,
  recipient: CampaignRecipient,
  lead: Lead,
): Promise<void> {
  const mailbox = await pickMailbox(campaign.userId, campaign.distributionMethod);
  if (!mailbox) {
    // No mailbox available — surface as a "no capacity this tick" signal by
    // throwing a sentinel the caller recognizes, so this campaign's loop
    // stops without touching the recipient's attempt/backoff state.
    throw NO_MAILBOX;
  }

  const subject = renderTemplate(resolveSpintax(campaign.subject ?? ''), lead);
  const body = renderTemplate(resolveSpintax(campaign.body ?? ''), lead);
  const sentAt = new Date();

  const tracked = buildTrackedEmail({
    recipientId: recipient.id,
    subject,
    body,
    plainTextMode: campaign.plainTextMode,
    openTracking: campaign.openTracking,
    linkTracking: campaign.linkTracking,
  });

  const messageId = await sendFromMailbox(mailbox, {
    to: lead.email,
    subject,
    text: tracked.text,
    html: tracked.html,
    headers: unsubscribeHeaders(tracked.unsubscribeUrl),
  });

  await recordMailboxSend(mailbox);
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: LeadStatus.CONTACTED, lastContacted: sentAt },
  });
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { sentCount: { increment: 1 } },
  });

  const autoFollowUps = parseAutoFollowUps(campaign.autoFollowUps);

  // Queue the campaign's auto follow-ups through the existing scheduler,
  // reply-gated and threaded onto the initial message.
  let cumulativeMs = 0;
  for (const [index, followUp] of autoFollowUps.entries()) {
    cumulativeMs += followUpDelayMs(followUp);
    const followUpSubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    const followUpBody = renderTemplate(resolveSpintax(followUp.content), lead);
    const followUpTracked = buildTrackedEmail({
      recipientId: recipient.id,
      subject: followUpSubject,
      body: followUpBody,
      plainTextMode: campaign.plainTextMode,
      openTracking: campaign.openTracking,
      linkTracking: campaign.linkTracking,
    });
    await scheduleFollowup({
      userId: campaign.userId,
      provider: mailbox.provider === 'GMAIL' ? 'gmail' : 'microsoft',
      to: lead.email,
      subject: followUpSubject,
      body: followUpTracked.text,
      html: followUpTracked.html,
      scheduledAt: new Date(sentAt.getTime() + cumulativeMs).toISOString(),
      campaignId: campaign.id,
      leadId: lead.id,
      stepIndex: index,
      skipIfReplied: campaign.stopOnReply,
      originalMessageId: messageId,
      initialSentAt: sentAt.toISOString(),
      recipientEmail: lead.email,
    });
  }

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status: autoFollowUps.length > 0 ? RecipientStatus.IN_SEQUENCE : RecipientStatus.COMPLETED,
      currentStep: 1,
      lastSentAt: sentAt,
      lastError: null,
    },
  });

  logger.info(
    { campaignId: campaign.id, to: maskEmail(lead.email), mailbox: maskEmail(mailbox.email), messageId },
    'Campaign email dispatched',
  );
}

/**
 * Bump a campaign's per-day send counter. Staleness (new UTC day) is
 * resolved once up front in processCampaign before any sends happen this
 * tick, so this is always a plain increment.
 */
async function recordCampaignSend(campaignId: string): Promise<void> {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { sentToday: { increment: 1 } },
  });
}

// Bounce rate is only meaningful once a campaign has sent a minimum volume —
// otherwise a single early bounce (5-10% by definition, with sentCount<20)
// would pause a campaign that just started.
const BOUNCE_PAUSE_MIN_SENT = 20;
const BOUNCE_PAUSE_RATE = 0.05;

/**
 * A hard SMTP bounce (isHardBounceError, see engine.ts): mark the lead so it
 * is never targeted again, fail this recipient permanently (no retry — a
 * hard bounce will never succeed), record a BOUNCED tracking event, and bump
 * the campaign's bounce counter. Auto-pauses the campaign once its bounce
 * rate crosses BOUNCE_PAUSE_RATE (domain-level rate limiting, scoped per
 * campaign — see schema.prisma Campaign.pausedReason).
 */
async function handleHardBounce(campaign: Campaign, recipient: CampaignRecipient, lead: Lead, message: string): Promise<boolean> {
  await prisma.lead.update({
    where: { id: lead.id },
    data: { isBounced: true, bounceCount: { increment: 1 }, lastBounceAt: new Date() },
  });

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: RecipientStatus.FAILED, lastError: message },
  });

  await prisma.trackingEvent.create({
    data: {
      userId: campaign.userId,
      leadId: lead.id,
      campaignId: campaign.id,
      type: TrackingEventType.BOUNCED,
      meta: { message },
    },
  });

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { bouncedCount: { increment: 1 } },
  });

  logger.warn({ campaignId: campaign.id, leadId: lead.id, message }, 'Hard bounce detected');

  if (
    updated.status !== CampaignStatus.PAUSED &&
    updated.sentCount >= BOUNCE_PAUSE_MIN_SENT &&
    updated.bouncedCount / updated.sentCount >= BOUNCE_PAUSE_RATE
  ) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.PAUSED, pausedReason: 'BOUNCE_RATE' },
    });
    logger.warn(
      { campaignId: campaign.id, bouncedCount: updated.bouncedCount, sentCount: updated.sentCount },
      'Campaign auto-paused: bounce rate threshold reached',
    );
    return true;
  }
  return false;
}

async function processCampaign(campaign: Campaign): Promise<void> {
  if (!isWithinSendWindow(campaign)) {
    return; // outside the configured send window/day — try again next tick
  }

  // Per-send pacing: skip this tick entirely until nextSendAt arrives.
  if (campaign.sendIntervalMinutes != null && campaign.nextSendAt && campaign.nextSendAt.getTime() > Date.now()) {
    return;
  }

  const totalRecipients = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id } });

  if (totalRecipients === 0) {
    if (campaign.createdAt < LEGACY_RECIPIENT_CUTOFF) {
      await materializeLegacyRecipients(campaign);
      return; // pick up the newly-materialized rows next tick
    }
    // Genuinely empty campaign — nothing to send, nothing pending.
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { progress: 100, status: CampaignStatus.COMPLETED },
    });
    return;
  }

  // Roll the daily counter forward ONCE, up front, if it's stale — otherwise
  // every send this tick would independently see a stale counterDate and
  // reset sentToday to 1 instead of incrementing (recordCampaignSend below
  // assumes counterDate is already current for the whole tick).
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  if (campaign.counterDate.getTime() < today.getTime()) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { sentToday: 0, counterDate: today } });
    campaign = { ...campaign, sentToday: 0, counterDate: today };
  }

  const tickCap = campaign.sendIntervalMinutes != null ? 1 : BATCH_SIZE;
  const budget = Math.min(remainingDailyBudget(campaign), tickCap);
  if (budget <= 0) return; // daily cap reached; try again tomorrow

  const due = await prisma.campaignRecipient.findMany({
    where: {
      campaignId: campaign.id,
      status: RecipientStatus.PENDING,
      OR: [{ nextSendAt: null }, { nextSendAt: { lte: new Date() } }],
    },
    orderBy: [{ nextSendAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: budget,
  });

  // Follow-up priority (Campaign.followUpPercent, 0-100): while this
  // campaign has due FollowupJobs waiting, throttle NEW-recipient sends
  // probabilistically so follow-ups aren't starved by a large new-lead
  // backlog. 0% = always send new leads; 100% = always defer to follow-ups.
  let dueFollowUps = 0;
  if (campaign.followUpPercent > 0 && due.length > 0) {
    dueFollowUps = await prisma.followupJob.count({
      where: { campaignId: campaign.id, status: FollowupJobStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
    });
  }

  for (const recipient of due) {
    if (dueFollowUps > 0 && randomInt(100) < campaign.followUpPercent) {
      continue; // yield this tick's slot to the pending follow-up backlog
    }

    // Atomic claim: PENDING -> SENDING compare-and-set, exactly
    // followupScheduler.ts's idiom. A crash between the SMTP send and this
    // recipient's post-send DB update (or a second worker instance racing
    // this one) previously left the row PENDING, so the next tick would
    // dispatch it again — a real duplicate send. Claiming first means only
    // one tick/instance can ever hold this recipient; see
    // recoverStaleSendingRecipients() for what happens if the holder crashes.
    const claimed = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: RecipientStatus.PENDING },
      data: { status: RecipientStatus.SENDING },
    });
    if (claimed.count !== 1) continue; // already claimed by a concurrent tick/instance

    const lead = await prisma.lead.findUnique({ where: { id: recipient.leadId } });
    if (!lead || lead.isBounced) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: RecipientStatus.SKIPPED, lastError: lead ? 'Lead is bounced' : 'Lead no longer exists' },
      });
      continue;
    }
    if (lead.status !== LeadStatus.NEW) {
      // Already contacted/replied/lost via another path since this row was queued.
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: RecipientStatus.SKIPPED, lastError: `Lead status is ${lead.status}, not NEW` },
      });
      continue;
    }

    try {
      await dispatchRecipient(campaign, recipient, lead);
      await recordCampaignSend(campaign.id);

      if (campaign.sendIntervalMinutes != null) {
        const jitterMs = 30_000 + randomInt(30_001); // 30-60s random jitter
        const nextSendAt = new Date(Date.now() + campaign.sendIntervalMinutes * 60_000 + jitterMs);
        await prisma.campaign.update({ where: { id: campaign.id }, data: { nextSendAt } });
        campaign = { ...campaign, nextSendAt };
      }
    } catch (err) {
      if (err === NO_MAILBOX) {
        // Release the claim — no capacity this tick, not a failed send.
        await prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: RecipientStatus.SENDING },
          data: { status: RecipientStatus.PENDING },
        });
        logger.warn(
          { campaignId: campaign.id },
          'Campaign dispatch paused this tick: no mailbox under its daily limit',
        );
        break; // stop this campaign's loop only; other campaigns keep ticking
      }

      const message = err instanceof Error ? err.message : String(err);

      if (isLimitExceededError(err)) {
        // Tier email cap reached — not the recipient's fault; pause this
        // campaign's dispatch for the tick without burning a retry attempt.
        await prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: RecipientStatus.SENDING },
          data: { status: RecipientStatus.PENDING },
        });
        logger.warn({ campaignId: campaign.id, err: message }, 'Campaign dispatch paused: tier email limit reached');
        break;
      }

      if (isHardBounceError(err)) {
        // handleHardBounce sets a terminal FAILED status itself, which
        // releases the SENDING claim as a side effect.
        const paused = await handleHardBounce(campaign, recipient, lead, message);
        if (paused) break; // stop dispatching more of this campaign's recipients this tick
        continue;
      }

      if (isSoftBounceError(err)) {
        // Soft bounce (mailbox full / greylisting): still retried below like
        // any transient error, but tracked per lead — at the threshold the
        // address is treated as undeliverable and permanently skipped.
        const updatedLead = await prisma.lead.update({
          where: { id: lead.id },
          data: { bounceCount: { increment: 1 }, lastBounceAt: new Date() },
        });
        if (updatedLead.bounceCount >= SOFT_BOUNCE_THRESHOLD) {
          await prisma.lead.update({ where: { id: lead.id }, data: { isBounced: true } });
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: RecipientStatus.FAILED, attemptCount: recipient.attemptCount + 1, lastError: `Soft-bounce threshold reached: ${message}` },
          });
          await prisma.trackingEvent.create({
            data: {
              userId: campaign.userId,
              leadId: lead.id,
              campaignId: campaign.id,
              type: TrackingEventType.BOUNCED,
              meta: { message, soft: true },
            },
          });
          logger.warn({ campaignId: campaign.id, leadId: lead.id, bounceCount: updatedLead.bounceCount }, 'Lead flipped isBounced after repeated soft bounces');
          continue;
        }
      }

      const attemptCount = recipient.attemptCount + 1;
      const retryDelayMs = computeNextRetryDelayMs(attemptCount);

      logger.error({ err, campaignId: campaign.id, leadId: lead.id, attemptCount }, 'Campaign send failed for recipient');

      if (retryDelayMs === null) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: RecipientStatus.FAILED, attemptCount, lastError: message },
        });
      } else {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: RecipientStatus.PENDING, // release the claim so the retry can be picked up
            attemptCount,
            lastError: message,
            nextSendAt: new Date(Date.now() + retryDelayMs),
          },
        });
      }
    }
  }

  const [openCount, terminalCount] = await Promise.all([
    // PENDING (queued) or SENDING (claimed, in flight/stranded) — either way
    // the campaign isn't done. Counting SENDING here too matters: without it
    // a recipient stranded mid-claim (see recoverStaleSendingRecipients)
    // would read as "nothing left to send" and the campaign would flip to
    // COMPLETED while that recipient is still unresolved.
    prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: { in: [RecipientStatus.PENDING, RecipientStatus.SENDING] } },
    }),
    prisma.campaignRecipient.count({
      where: {
        campaignId: campaign.id,
        status: { in: [RecipientStatus.COMPLETED, RecipientStatus.IN_SEQUENCE, RecipientStatus.REPLIED, RecipientStatus.FAILED, RecipientStatus.SKIPPED] },
      },
    }),
  ]);

  const progress = totalRecipients > 0 ? Math.round((terminalCount / totalRecipients) * 100) : 100;

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      progress,
      ...(openCount === 0 ? { status: CampaignStatus.COMPLETED } : {}),
    },
  });
}

// A recipient claimed to SENDING (see the compare-and-set above) has no
// in-process finally{} left to release it if the process dies mid-dispatch —
// it would otherwise stay SENDING forever, permanently blocking its campaign
// from ever completing (see the openCount check in processCampaign). A
// SENDING row whose updatedAt is older than this timeout is treated as
// stranded and put back to PENDING for the next tick to reclaim. Mirrors
// followupScheduler.ts's recoverStaleSendingJobs() for the same failure mode.
const STALE_SENDING_TIMEOUT_MS = 15 * 60_000;

/** Reset any CampaignRecipient stuck in SENDING past the timeout back to PENDING. */
async function recoverStaleSendingRecipients(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_TIMEOUT_MS);
  const stale = await prisma.campaignRecipient.findMany({
    where: { status: RecipientStatus.SENDING, updatedAt: { lte: staleBefore } },
    select: { id: true, campaignId: true },
  });
  if (stale.length === 0) return;

  for (const recipient of stale) {
    const claimed = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: RecipientStatus.SENDING },
      data: {
        status: RecipientStatus.PENDING,
        lastError: 'Stranded in SENDING past timeout (process restart); recovered automatically.',
      },
    });
    if (claimed.count === 1) {
      logger.warn(
        { recipientId: recipient.id, campaignId: recipient.campaignId },
        'Recovered a stale SENDING campaign recipient',
      );
    }
  }
}

/** One worker pass. Exported for tests. */
export async function campaignTickOnce(): Promise<void> {
  await recoverStaleSendingRecipients();

  // Promote due SCHEDULED campaigns to ACTIVE.
  await prisma.campaign.updateMany({
    where: { status: CampaignStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
    data: { status: CampaignStatus.ACTIVE },
  });

  const active = await prisma.campaign.findMany({
    where: { status: CampaignStatus.ACTIVE },
    orderBy: { createdAt: 'asc' },
  });

  for (const campaign of active) {
    try {
      await processCampaign(campaign);
    } catch (err) {
      logger.error({ err, campaignId: campaign.id }, 'Campaign tick failed');
    }
  }
}

let started = false;
let ticking = false;
let lastTickAt: Date | null = null;

/** When the campaign worker last completed a tick (null = never). For health checks. */
export function lastCampaignTickAt(): Date | null {
  return lastTickAt;
}

export function startCampaignWorker(options?: { tickMs?: number }): void {
  if (started) return;
  started = true;

  const intervalMs = options?.tickMs && options.tickMs > 0 ? options.tickMs : 60_000;

  const run = async () => {
    if (ticking) return; // a slow tick must not overlap the next one
    ticking = true;
    try {
      await campaignTickOnce();
      lastTickAt = new Date();
    } catch (err) {
      logger.error({ err }, 'Campaign worker tick failed');
    } finally {
      ticking = false;
    }
  };

  void run();
  setInterval(run, intervalMs);
  logger.info({ intervalMs, batchSize: BATCH_SIZE }, 'Campaign worker started');
}
