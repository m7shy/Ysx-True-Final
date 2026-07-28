import { ImapFlow } from 'imapflow';
import { LeadStatus, TrackingEventType, type Lead, type Mailbox } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { maskEmail } from '../util/redact.js';
import { connectionForMailbox } from '../creds/mailboxStore.js';
import { cancelScheduledFollowupsForUserRecipient } from '../scheduler/followupScheduler.js';
import { classifyReplyIntent, type ReplyIntent } from './intent.js';
import { mayPoll, reportWork } from '../scheduler/pulse.js';

/**
 * Unibox reply listener (polling — Gmail/Microsoft IMAP has no webhook here).
 *
 * Each tick it scans every tenant's connected inboxes for messages from leads
 * in status CONTACTED. When a reply is found, its intent is categorized with
 * a lightweight AI prompt (see intent.ts) and the recipient's outbound
 * sequence is paused: all scheduled followups for that recipient are
 * cancelled, the lead moves to REPLIED (or LOST if not interested), and the
 * originating campaigns' repliedCount is bumped. An out-of-office autoreply
 * pauses nothing.
 */

// Cap of contacted leads scanned per tick (oldest-contacted first).
const SCAN_LIMIT = Math.max(1, Number(process.env.UNIBOX_SCAN_LIMIT ?? 100));

/** Crude plaintext extraction from a raw RFC822 source — enough for intent. */
function extractBodyText(source: string): string {
  const bodyStart = source.indexOf('\r\n\r\n');
  const body = bodyStart >= 0 ? source.slice(bodyStart + 4) : source;
  return body
    .replace(/=\r?\n/g, '') // quoted-printable soft line breaks
    .replace(/<[^>]+>/g, ' ') // strip HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

async function findReplySource(client: ImapFlow, lead: Lead): Promise<string | null> {
  const criteria: any = { from: lead.email };
  if (lead.lastContacted) criteria.since = lead.lastContacted;

  const uids = await client.search(criteria, { uid: true });
  if (!Array.isArray(uids) || uids.length === 0) return null;

  const latest = uids[uids.length - 1];
  const msg = await client.fetchOne(String(latest), { source: true, internalDate: true, envelope: true }, { uid: true });

  // IMAP `since` is accurate only to the day, so a message this contact sent
  // BEFORE our outreach went out that same day would otherwise be handled as a
  // reply — cancelling the sequence and bumping repliedCount off an email that
  // was never a response to anything.
  const received = (msg as any)?.internalDate ?? (msg as any)?.envelope?.date;
  if (lead.lastContacted && received && new Date(received).getTime() < new Date(lead.lastContacted).getTime()) {
    return null;
  }

  const source = (msg as any)?.source?.toString?.('utf8');
  // Return null, NOT ''. The caller's guard is `if (source === null) continue`,
  // so an empty string fell through and was treated as a real reply: the body
  // classified as NEUTRAL, the lead was marked REPLIED and its follow-ups were
  // cancelled — all because a fetch came back empty. A message we could not
  // read is not evidence that someone replied.
  return typeof source === 'string' && source.length > 0 ? source : null;
}

async function handleReply(lead: Lead, intent: ReplyIntent): Promise<void> {
  if (intent === 'OUT_OF_OFFICE') {
    logger.info({ lead: maskEmail(lead.email) }, 'Out-of-office autoreply detected; sequence continues');
    return;
  }

  const campaignIds = await cancelScheduledFollowupsForUserRecipient(
    lead.userId,
    lead.email,
    'replied',
  );

  for (const campaignId of campaignIds) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { repliedCount: { increment: 1 } },
    });
  }

  // Durable record for analytics (/api/analytics/summary counts REPLIED
  // events). campaignId is optional on TrackingEvent; attribute the reply to
  // the first paused campaign when there is one, else record it campaign-less
  // (e.g. a manually contacted lead). Never let a failure here abort the
  // reply handling itself.
  try {
    await prisma.trackingEvent.create({
      data: {
        userId: lead.userId,
        leadId: lead.id,
        campaignId: campaignIds[0] ?? null,
        type: TrackingEventType.REPLIED,
        meta: { intent },
      },
    });
  } catch (err) {
    logger.error({ err, leadId: lead.id }, 'Failed to record REPLIED tracking event');
  }

  const intelligence = {
    ...(typeof lead.intelligence === 'object' && lead.intelligence !== null ? lead.intelligence : {}),
    replyIntent: intent,
    replyDetectedAt: new Date().toISOString(),
  };

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: intent === 'NOT_INTERESTED' ? LeadStatus.LOST : LeadStatus.REPLIED,
      intelligence,
    },
  });

  logger.info(
    { lead: maskEmail(lead.email), intent, pausedCampaigns: campaignIds },
    'Reply detected; outbound sequence paused',
  );
}

async function scanMailbox(mailbox: Mailbox, leads: Lead[]): Promise<Set<string>> {
  const handled = new Set<string>();
  const conn = await connectionForMailbox(mailbox);

  const client = new ImapFlow({
    host: conn.imapHost,
    port: conn.imapPort,
    secure: conn.imapSecure,
    auth: { user: conn.email, accessToken: conn.accessToken },
    logger: false,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: conn.provider === 'microsoft' ? 60000 : 15000,
    greetingTimeout: conn.provider === 'microsoft' ? 60000 : 15000,
    socketTimeout: conn.provider === 'microsoft' ? 120000 : 30000,
  } as any);

  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });

    for (const lead of leads) {
      try {
        const source = await findReplySource(client, lead);
        if (source === null) continue;

        const intent = await classifyReplyIntent(extractBodyText(source));
        await handleReply(lead, intent);
        handled.add(lead.id);
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'Reply scan failed for lead');
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  return handled;
}

/** One poller pass. Exported for tests. */
export async function replyPollTickOnce(): Promise<void> {
  const contacted = await prisma.lead.findMany({
    where: { status: LeadStatus.CONTACTED },
    orderBy: { lastContacted: 'asc' },
    take: SCAN_LIMIT,
  });
  if (contacted.length === 0) return;

  // Leads awaiting a reply = keep checking promptly; a reply that sits unseen
  // for half an hour delays cancelling the rest of that sequence.
  reportWork();

  const byUser = new Map<string, Lead[]>();
  for (const lead of contacted) {
    const list = byUser.get(lead.userId) ?? [];
    list.push(lead);
    byUser.set(lead.userId, list);
  }

  for (const [userId, leads] of byUser) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { userId, isActive: true },
    });

    // A reply can land in any of the tenant's inboxes; stop scanning a lead
    // once one mailbox has handled it.
    let pending = leads;
    for (const mailbox of mailboxes) {
      if (pending.length === 0) break;
      try {
        const handled = await scanMailbox(mailbox, pending);
        pending = pending.filter((l) => !handled.has(l.id));
      } catch (err) {
        logger.error({ err, mailbox: maskEmail(mailbox.email) }, 'Inbox reply scan failed');
      }
    }
  }
}

let started = false;
let ticking = false;

export function startReplyPoller(options?: { pollMs?: number }): void {
  if (started) return;
  started = true;

  const intervalMs = options?.pollMs && options.pollMs > 0 ? options.pollMs : 300_000;

  const run = async () => {
    if (ticking) return;
    // Nothing to poll for when no lead is awaiting a reply; this loop's 5-minute
    // cadence sat exactly at Neon's suspend threshold, so on its own it was
    // enough to keep the compute alive permanently.
    if (!mayPoll('replyPoller')) return;
    ticking = true;
    try {
      await replyPollTickOnce();
    } catch (err) {
      logger.error({ err }, 'Reply poller tick failed');
    } finally {
      ticking = false;
    }
  };

  void run();
  setInterval(run, intervalMs);
  logger.info({ intervalMs }, 'Unibox reply poller started');
}
