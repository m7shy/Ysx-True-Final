// FILE: server/src/unibox/routes.ts

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { LeadStatus, type Lead } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { requireUserId } from '../auth/middleware.js';
import { pickRotationMailbox } from '../creds/mailboxStore.js';
import { sendFromMailbox } from '../mail/smtpGateway.js';
import { enforceDnc } from '../leads/dnc.js';

/**
 * Unibox (tenant-scoped), backed by the Lead table — Phase 1 has no Message
 * model, so a "thread" is a Lead that has been contacted at least once, and
 * its message history is reconstructed from Lead.intelligence (a JSON blob
 * the reply poller already writes replyIntent/replyDetectedAt into — see
 * unibox/replyPoller.ts). Manual replies sent from this router are appended
 * to intelligence.manualMessages so they persist across reloads.
 */

const router = express.Router();

const THREAD_STATUSES = ['UNREAD', 'READ', 'ARCHIVED'] as const;
const LEAD_THREAD_STATUSES = ['INTERESTED', 'NOT_INTERESTED', 'MEETING_BOOKED', 'LEFT_HANGING', 'DNC'] as const;

// Thread disposition → canonical Lead.status. LEFT_HANGING is absent on
// purpose: it's "no disposition yet" and must not clobber the pipeline status.
const THREAD_STATUS_TO_LEAD_STATUS: Partial<Record<(typeof LEAD_THREAD_STATUSES)[number], LeadStatus>> = {
  INTERESTED: LeadStatus.INTERESTED,
  NOT_INTERESTED: LeadStatus.LOST,
  MEETING_BOOKED: LeadStatus.CALL_BOOKED,
  DNC: LeadStatus.DNC,
};

type ManualMessage = { id: string; sender: 'ME' | 'LEAD'; content: string; date: string };

function intelligenceOf(lead: Lead): Record<string, any> {
  return typeof lead.intelligence === 'object' && lead.intelligence !== null
    ? (lead.intelligence as Record<string, any>)
    : {};
}

function defaultLeadThreadStatus(lead: Lead): (typeof LEAD_THREAD_STATUSES)[number] {
  if (lead.status === LeadStatus.DNC) return 'DNC';
  if (lead.status === LeadStatus.LOST) return 'NOT_INTERESTED';
  if (lead.status === LeadStatus.CALL_BOOKED) return 'MEETING_BOOKED';
  if (lead.status === LeadStatus.REPLIED || lead.status === LeadStatus.INTERESTED) return 'INTERESTED';
  return 'LEFT_HANGING';
}

function toThread(lead: Lead) {
  const intel = intelligenceOf(lead);
  const manualMessages: ManualMessage[] = Array.isArray(intel.manualMessages) ? intel.manualMessages : [];

  const messages: ManualMessage[] = [
    {
      id: `${lead.id}-outreach`,
      sender: 'ME',
      content: 'Initial outreach sent.',
      date: (lead.lastContacted ?? lead.createdAt).toISOString(),
    },
  ];

  if (lead.status === LeadStatus.REPLIED || lead.status === LeadStatus.LOST) {
    messages.push({
      id: `${lead.id}-reply`,
      sender: 'LEAD',
      content: intel.replyIntent
        ? `Replied — detected intent: ${String(intel.replyIntent).replace(/_/g, ' ').toLowerCase()}.`
        : 'Replied.',
      date: typeof intel.replyDetectedAt === 'string' ? intel.replyDetectedAt : lead.updatedAt.toISOString(),
    });
  }

  messages.push(...manualMessages);
  messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    id: lead.id,
    leadId: lead.id,
    leadName: lead.name,
    leadEmail: lead.email,
    leadCompany: lead.company ?? '',
    subject: `Conversation with ${lead.name}`,
    status: THREAD_STATUSES.includes(intel.threadStatus) ? intel.threadStatus : 'UNREAD',
    leadStatus: LEAD_THREAD_STATUSES.includes(intel.threadLeadStatus)
      ? intel.threadLeadStatus
      : defaultLeadThreadStatus(lead),
    lastMessageDate: messages[messages.length - 1].date,
    messages,
  };
}

function toErrorPayload(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof z.ZodError) {
    return { status: 400, code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { status: 500, code: 'UNKNOWN', message };
}

async function findLeadOr404(userId: string, id: string, res: Response): Promise<Lead | null> {
  const lead = await prisma.lead.findFirst({ where: { id, userId } });
  if (!lead) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Thread not found' });
    return null;
  }
  return lead;
}

/** GET /api/unibox/threads — every lead that has an active conversation. */
router.get('/threads', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const leads = await prisma.lead.findMany({
    where: { userId, status: { in: [LeadStatus.CONTACTED, LeadStatus.REPLIED, LeadStatus.LOST, LeadStatus.CALL_BOOKED] } },
    orderBy: { lastContacted: 'desc' },
  });
  res.json({ threads: leads.map(toThread) });
});

/** PATCH /api/unibox/threads/:id/status — UNREAD | READ | ARCHIVED */
router.patch('/threads/:id/status', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const { status } = z.object({ status: z.enum(THREAD_STATUSES) }).parse(req.body);

    const lead = await findLeadOr404(userId, req.params.id, res);
    if (!lead) return;

    const intelligence = { ...intelligenceOf(lead), threadStatus: status };
    await prisma.lead.update({ where: { id: lead.id }, data: { intelligence } });
    res.json({ ok: true });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** PATCH /api/unibox/threads/:id/lead-status — INTERESTED | NOT_INTERESTED | MEETING_BOOKED | LEFT_HANGING */
router.patch('/threads/:id/lead-status', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const { leadStatus } = z.object({ leadStatus: z.enum(LEAD_THREAD_STATUSES) }).parse(req.body);

    const lead = await findLeadOr404(userId, req.params.id, res);
    if (!lead) return;

    const intelligence = { ...intelligenceOf(lead), threadLeadStatus: leadStatus };
    const canonical = THREAD_STATUS_TO_LEAD_STATUS[leadStatus];
    await prisma.lead.update({
      where: { id: lead.id },
      data: { intelligence, ...(canonical ? { status: canonical } : {}) },
    });

    // DNC is a hard block: kill every queued follow-up and pending campaign
    // send for this lead immediately.
    if (leadStatus === 'DNC' && lead.status !== LeadStatus.DNC) {
      await enforceDnc(userId, lead);
    }

    res.json({ ok: true });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** POST /api/unibox/threads/:id/reply — send a real email reply via the tenant's rotation mailbox. */
router.post('/threads/:id/reply', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const { content } = z.object({ content: z.string().min(1, 'content is required') }).parse(req.body);

    const lead = await findLeadOr404(userId, req.params.id, res);
    if (!lead) return;

    const mailbox = await pickRotationMailbox(userId);
    if (!mailbox) {
      res.status(409).json({ code: 'NO_MAILBOX', message: 'No connected mailbox is available to send from' });
      return;
    }

    await sendFromMailbox(mailbox, {
      to: lead.email,
      subject: `Re: Conversation with ${lead.name}`,
      text: content,
    });

    const manualMessages: ManualMessage[] = Array.isArray(intelligenceOf(lead).manualMessages)
      ? intelligenceOf(lead).manualMessages
      : [];
    manualMessages.push({
      id: `${lead.id}-manual-${Date.now()}`,
      sender: 'ME',
      content,
      date: new Date().toISOString(),
    });

    const intelligence = { ...intelligenceOf(lead), manualMessages };
    const updated = await prisma.lead.update({ where: { id: lead.id }, data: { intelligence } });
    res.json({ thread: toThread(updated) });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

export default router;
