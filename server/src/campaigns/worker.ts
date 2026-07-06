import { CampaignStatus, LeadStatus, type Campaign, type Lead } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { maskEmail } from '../util/redact.js';
import { sendFromMailbox } from '../mail/smtpGateway.js';
import { pickRotationMailbox, recordMailboxSend } from '../creds/mailboxStore.js';
import { scheduleFollowup } from '../scheduler/followupScheduler.js';
import { resolveSpintax } from './spintax.js';

/**
 * Phase 4 outbound engine: a background worker that pulls active campaigns
 * from the database each tick and dispatches their emails through the
 * tenant's connected OAuth2 mailboxes, rotating inboxes per send.
 *
 * Recipient model: Phase 1 deliberately has no campaign↔lead join table, so a
 * campaign targets its owner's leads in status NEW; a dispatched lead moves to
 * CONTACTED, which doubles as the "already sent" marker.
 */

// Max sends per campaign per tick — keeps a tick short and paces volume.
const BATCH_SIZE = Math.max(1, Number(process.env.CAMPAIGN_BATCH_SIZE ?? 10));

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

async function dispatchLead(campaign: Campaign, lead: Lead): Promise<boolean> {
  const mailbox = await pickRotationMailbox(campaign.userId);
  if (!mailbox) {
    logger.warn(
      { campaignId: campaign.id },
      'Campaign dispatch paused this tick: no mailbox under its daily limit',
    );
    return false; // stop the whole batch — every lead needs a mailbox
  }

  const subject = resolveSpintax(campaign.subject ?? '');
  const body = resolveSpintax(campaign.body ?? '');
  const sentAt = new Date();

  const messageId = await sendFromMailbox(mailbox, {
    to: lead.email,
    subject,
    text: body,
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

  // Queue the campaign's auto follow-ups through the existing scheduler,
  // reply-gated and threaded onto the initial message.
  let cumulativeMs = 0;
  for (const [index, followUp] of parseAutoFollowUps(campaign.autoFollowUps).entries()) {
    cumulativeMs += followUpDelayMs(followUp);
    await scheduleFollowup({
      userId: campaign.userId,
      provider: mailbox.provider === 'GMAIL' ? 'gmail' : 'microsoft',
      to: lead.email,
      subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`,
      body: resolveSpintax(followUp.content),
      scheduledAt: new Date(sentAt.getTime() + cumulativeMs).toISOString(),
      campaignId: campaign.id,
      leadId: lead.id,
      stepIndex: index,
      skipIfReplied: true,
      originalMessageId: messageId,
      initialSentAt: sentAt.toISOString(),
      recipientEmail: lead.email,
    });
  }

  logger.info(
    { campaignId: campaign.id, to: maskEmail(lead.email), mailbox: maskEmail(mailbox.email), messageId },
    'Campaign email dispatched',
  );
  return true;
}

async function processCampaign(campaign: Campaign): Promise<void> {
  const [totalLeads, batch] = await Promise.all([
    prisma.lead.count({ where: { userId: campaign.userId } }),
    prisma.lead.findMany({
      where: { userId: campaign.userId, status: LeadStatus.NEW },
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: BATCH_SIZE,
    }),
  ]);

  let remainingNew = await prisma.lead.count({
    where: { userId: campaign.userId, status: LeadStatus.NEW },
  });

  for (const lead of batch) {
    try {
      const sent = await dispatchLead(campaign, lead);
      if (!sent) break; // all mailboxes exhausted; retry next tick
      remainingNew -= 1;
    } catch (err) {
      // A failing lead (bad address, SMTP error) must not stall the campaign;
      // mark it LOST so it isn't retried forever.
      logger.error({ err, campaignId: campaign.id, leadId: lead.id }, 'Campaign send failed for lead');
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: LeadStatus.LOST, notes: `Send failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      remainingNew -= 1;
    }
  }

  const progress =
    totalLeads > 0 ? Math.round(((totalLeads - remainingNew) / totalLeads) * 100) : 100;

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      progress,
      ...(remainingNew <= 0 ? { status: CampaignStatus.COMPLETED } : {}),
    },
  });
}

/** One worker pass. Exported for tests. */
export async function campaignTickOnce(): Promise<void> {
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

export function startCampaignWorker(options?: { tickMs?: number }): void {
  if (started) return;
  started = true;

  const intervalMs = options?.tickMs && options.tickMs > 0 ? options.tickMs : 60_000;

  const run = async () => {
    if (ticking) return; // a slow tick must not overlap the next one
    ticking = true;
    try {
      await campaignTickOnce();
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
