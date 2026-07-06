// FILE: server/src/campaigns/routes.ts

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { CampaignStatus, LeadStatus, type Campaign } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { requireUserId } from '../auth/middleware.js';

/**
 * Campaigns CRUD (tenant-scoped), shaped to match the frontend's `Campaign`
 * type (types.ts) directly so the client does minimal reshaping.
 *
 * Phase 1 has no campaign<->lead join table (see campaigns/worker.ts): the
 * outbound engine dispatches a running campaign against its owner's leads in
 * status NEW. `recipients` on create is accepted as a convenience — each one
 * is upserted into the Lead table (status NEW) so the worker has something to
 * send to — but the response never echoes back a per-campaign recipient list,
 * since the DB doesn't track that association.
 */

const router = express.Router();

const CAMPAIGN_STATUSES = Object.values(CampaignStatus) as [string, ...string[]];

const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().optional(),
  company: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1, 'name is required'),
  subject: z.string().optional(),
  body: z.string().optional(),
  scheduledAt: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  distributionMethod: z.string().optional(),
  autoFollowUps: z.array(z.record(z.any())).optional(),
  sequence: z.array(z.record(z.any())).optional(),
  recipients: z.array(recipientSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  progress: z.number().int().min(0).max(100).optional(),
});

function toErrorPayload(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof z.ZodError) {
    return { status: 400, code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { status: 500, code: 'UNKNOWN', message };
}

/** Shape a DB Campaign row into the frontend's Campaign type. */
function toClientCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    recipients: [] as { email: string; name: string; company: string }[],
    subject: c.subject ?? '',
    body: c.body ?? '',
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : new Date().toISOString(),
    createdAt: c.createdAt.toISOString(),
    progress: c.progress,
    stats: {
      sent: c.sentCount,
      clicked: c.clickedCount,
      replied: c.repliedCount,
      opportunities: c.opportunitiesCount,
    },
    distributionMethod: c.distributionMethod ?? 'INDIVIDUAL',
    autoFollowUps: Array.isArray(c.autoFollowUps) ? c.autoFollowUps : [],
    sequence: Array.isArray(c.sequence) ? c.sequence : undefined,
  };
}

/** Upsert each recipient as a Lead in status NEW so the worker can dispatch to it. */
async function upsertRecipientsAsLeads(
  userId: string,
  recipients: z.infer<typeof recipientSchema>[],
): Promise<void> {
  for (const r of recipients) {
    await prisma.lead.upsert({
      where: { userId_email: { userId, email: r.email } },
      update: {},
      create: {
        userId,
        email: r.email,
        name: r.name || r.email,
        company: r.company,
        status: LeadStatus.NEW,
        source: 'campaign',
      },
    });
  }
}

/** GET /api/campaigns — list the tenant's campaigns, newest first. */
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ campaigns: campaigns.map(toClientCampaign) });
});

/** GET /api/campaigns/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, userId } });
  if (!campaign) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
    return;
  }
  res.json({ campaign: toClientCampaign(campaign) });
});

/** POST /api/campaigns */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const parsed = createSchema.parse(req.body);

    if (parsed.recipients?.length) {
      await upsertRecipientsAsLeads(userId, parsed.recipients);
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        name: parsed.name,
        subject: parsed.subject,
        body: parsed.body,
        scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : undefined,
        status: (parsed.status as CampaignStatus) ?? CampaignStatus.DRAFT,
        distributionMethod: parsed.distributionMethod,
        autoFollowUps: parsed.autoFollowUps,
        sequence: parsed.sequence,
      },
    });
    res.status(201).json({ campaign: toClientCampaign(campaign) });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** PATCH /api/campaigns/:id */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const parsed = updateSchema.parse(req.body);

    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
      return;
    }

    if (parsed.recipients?.length) {
      await upsertRecipientsAsLeads(userId, parsed.recipients);
    }

    const campaign = await prisma.campaign.update({
      where: { id: existing.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
        ...(parsed.scheduledAt !== undefined ? { scheduledAt: new Date(parsed.scheduledAt) } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status as CampaignStatus } : {}),
        ...(parsed.progress !== undefined ? { progress: parsed.progress } : {}),
        ...(parsed.distributionMethod !== undefined ? { distributionMethod: parsed.distributionMethod } : {}),
        ...(parsed.autoFollowUps !== undefined ? { autoFollowUps: parsed.autoFollowUps } : {}),
        ...(parsed.sequence !== undefined ? { sequence: parsed.sequence } : {}),
      },
    });
    res.json({ campaign: toClientCampaign(campaign) });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** DELETE /api/campaigns/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
    return;
  }
  await prisma.campaign.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
