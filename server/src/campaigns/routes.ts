// FILE: server/src/campaigns/routes.ts

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { CampaignStatus, LeadStatus, RecipientStatus, type Campaign, type Lead } from '@prisma/client';

import { tenantDb, type TenantClient } from '../db/tenantDb.js';
import { requireUserId } from '../auth/middleware.js';

/**
 * Campaigns CRUD (tenant-scoped), shaped to match the frontend's `Campaign`
 * type (types.ts) directly so the client does minimal reshaping.
 *
 * `recipients` on create/update is upserted into the Lead table (status NEW)
 * AND linked via CampaignRecipient rows — the outbound engine (worker.ts)
 * dispatches a running campaign against ONLY its own CampaignRecipient rows,
 * never the tenant's whole lead pool (see schema.prisma CampaignRecipient
 * comment for why that changed from the original Phase 1 design).
 */

const router = express.Router();

const CAMPAIGN_STATUSES = Object.values(CampaignStatus) as [string, ...string[]];
const DISTRIBUTION_METHODS = ['INDIVIDUAL', 'GROUP'] as [string, ...string[]];

const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().optional(),
  company: z.string().optional(),
  // Raw CSV columns (wizard Step 1), for {{variable}} interpolation at send
  // time (see campaigns/variables.ts). Capped so a malformed CSV can't blow
  // up the row.
  customFields: z
    .record(z.string().max(2000))
    .refine((obj) => Object.keys(obj).length <= 60, {
      message: 'customFields supports at most 60 keys',
    })
    .optional(),
});

// Matches types.ts AutoFollowUp exactly (delay/unit/content) — worker.ts's
// parseAutoFollowUps additionally tolerates unknown extra keys at runtime,
// but validation here rejects malformed entries up front instead of letting
// them silently vanish deep in the worker.
const autoFollowUpSchema = z.object({
  delay: z.number().min(0).max(365),
  unit: z.enum(['MINUTES', 'HOURS', 'DAYS', 'WEEKS']),
  content: z.string().min(1),
});

// Matches types.ts SequenceStep. Not independently executed by the worker
// (autoFollowUps is the authoritative follow-up schedule) — sequence is a
// denormalized snapshot the frontend renders as a step timeline.
const sequenceStepSchema = z.object({
  id: z.string(),
  step: z.number().int().min(1),
  subject: z.string(),
  body: z.string(),
  scheduledFor: z.string(),
  status: z.enum(['PENDING', 'SENT', 'SKIPPED']),
  type: z.enum(['INITIAL', 'FOLLOW_UP']),
});

const MAX_STEPS = 10;

const createSchema = z.object({
  name: z.string().min(1, 'name is required'),
  subject: z.string().optional(),
  body: z.string().optional(),
  scheduledAt: z.coerce.date().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  distributionMethod: z.enum(DISTRIBUTION_METHODS).optional(),
  autoFollowUps: z.array(autoFollowUpSchema).max(MAX_STEPS).optional(),
  sequence: z.array(sequenceStepSchema).max(MAX_STEPS + 1).optional(),
  recipients: z.array(recipientSchema).optional(),
  // Send window / pacing / reply behavior — previously collected in Compose
  // but never sent to the backend (see the old components/ComposeNewEmail.tsx,
  // replaced by the campaign creation wizard).
  sendWindowStart: z.number().int().min(0).max(1439).optional(),
  sendWindowEnd: z.number().int().min(0).max(1439).optional(),
  sendDays: z.number().int().min(0).max(127).optional(),
  timezone: z.string().max(64).optional(),
  dailyLimit: z.number().int().min(1).max(2000).optional(),
  stopOnReply: z.boolean().optional(),
  openTracking: z.boolean().optional(),
  linkTracking: z.boolean().optional(),
  // ── Campaign wizard additions ─────────────────────────────────────────
  sendIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  stopOnClick: z.boolean().optional(),
  stopOnOpen: z.boolean().optional(),
  plainTextMode: z.boolean().optional(),
  followUpPercent: z.number().int().min(0).max(100).optional(),
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
    sendWindowStart: c.sendWindowStart,
    sendWindowEnd: c.sendWindowEnd,
    sendDays: c.sendDays,
    timezone: c.timezone,
    dailyLimit: c.dailyLimit,
    stopOnReply: c.stopOnReply,
    openTracking: c.openTracking,
    linkTracking: c.linkTracking,
    sendIntervalMinutes: c.sendIntervalMinutes,
    stopOnClick: c.stopOnClick,
    stopOnOpen: c.stopOnOpen,
    plainTextMode: c.plainTextMode,
    followUpPercent: c.followUpPercent,
    bouncedCount: c.bouncedCount,
    pausedReason: c.pausedReason,
  };
}

/** Upsert each recipient as a Lead in status NEW, returning their lead ids. */
async function upsertRecipientsAsLeads(
  db: TenantClient,
  userId: string,
  recipients: z.infer<typeof recipientSchema>[],
): Promise<string[]> {
  const leadIds: string[] = [];
  for (const r of recipients) {
    let customFields = r.customFields;
    if (customFields) {
      const existing = await db.lead.findUnique({ where: { userId_email: { userId, email: r.email } } });
      const prior = (existing?.customFields as Record<string, string> | null) ?? null;
      if (prior) customFields = { ...prior, ...customFields };
    }
    const lead = await db.lead.upsert({
      where: { userId_email: { userId, email: r.email } },
      update: {
        ...(customFields !== undefined ? { customFields } : {}),
        // A fresh import is newer info than what's on file — but never
        // overwrite a real name/company with an empty value.
        ...(r.name ? { name: r.name } : {}),
        ...(r.company ? { company: r.company } : {}),
      },
      create: {
        userId,
        email: r.email,
        name: r.name || r.email,
        company: r.company,
        status: LeadStatus.NEW,
        source: 'campaign',
        customFields,
      },
    });
    leadIds.push(lead.id);
  }
  return leadIds;
}

/** Link leads to a campaign as CampaignRecipient rows (idempotent: skips duplicates). */
async function linkRecipients(db: TenantClient, userId: string, campaignId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  // userId is redundant with tenantDb's automatic stamping but required by
  // the generated CampaignRecipientCreateManyInput type.
  await db.campaignRecipient.createMany({
    data: leadIds.map((leadId) => ({ campaignId, leadId, userId, status: RecipientStatus.PENDING })),
    skipDuplicates: true,
  });
}

/** GET /api/campaigns — list the tenant's campaigns, newest first. */
router.get('/', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json({ campaigns: campaigns.map(toClientCampaign) });
});

/** GET /api/campaigns/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const campaign = await db.campaign.findFirst({ where: { id: req.params.id } });
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
    const db = tenantDb(userId);
    const parsed = createSchema.parse(req.body);

    const campaign = await db.campaign.create({
      data: {
        userId,
        name: parsed.name,
        subject: parsed.subject,
        body: parsed.body,
        scheduledAt: parsed.scheduledAt,
        status: (parsed.status as CampaignStatus) ?? CampaignStatus.DRAFT,
        distributionMethod: parsed.distributionMethod,
        autoFollowUps: parsed.autoFollowUps,
        sequence: parsed.sequence,
        sendWindowStart: parsed.sendWindowStart,
        sendWindowEnd: parsed.sendWindowEnd,
        sendDays: parsed.sendDays,
        timezone: parsed.timezone,
        dailyLimit: parsed.dailyLimit,
        ...(parsed.stopOnReply !== undefined ? { stopOnReply: parsed.stopOnReply } : {}),
        ...(parsed.openTracking !== undefined ? { openTracking: parsed.openTracking } : {}),
        ...(parsed.linkTracking !== undefined ? { linkTracking: parsed.linkTracking } : {}),
        ...(parsed.sendIntervalMinutes !== undefined ? { sendIntervalMinutes: parsed.sendIntervalMinutes } : {}),
        ...(parsed.stopOnClick !== undefined ? { stopOnClick: parsed.stopOnClick } : {}),
        ...(parsed.stopOnOpen !== undefined ? { stopOnOpen: parsed.stopOnOpen } : {}),
        ...(parsed.plainTextMode !== undefined ? { plainTextMode: parsed.plainTextMode } : {}),
        ...(parsed.followUpPercent !== undefined ? { followUpPercent: parsed.followUpPercent } : {}),
      },
    });

    if (parsed.recipients?.length) {
      const leadIds = await upsertRecipientsAsLeads(db, userId, parsed.recipients);
      await linkRecipients(db, userId, campaign.id, leadIds);
    }

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
    const db = tenantDb(userId);
    const parsed = updateSchema.parse(req.body);

    const existing = await db.campaign.findFirst({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
      return;
    }

    const campaign = await db.campaign.update({
      where: { id: existing.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
        ...(parsed.scheduledAt !== undefined ? { scheduledAt: parsed.scheduledAt } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status as CampaignStatus } : {}),
        ...(parsed.progress !== undefined ? { progress: parsed.progress } : {}),
        ...(parsed.distributionMethod !== undefined ? { distributionMethod: parsed.distributionMethod } : {}),
        ...(parsed.autoFollowUps !== undefined ? { autoFollowUps: parsed.autoFollowUps } : {}),
        ...(parsed.sequence !== undefined ? { sequence: parsed.sequence } : {}),
        ...(parsed.sendWindowStart !== undefined ? { sendWindowStart: parsed.sendWindowStart } : {}),
        ...(parsed.sendWindowEnd !== undefined ? { sendWindowEnd: parsed.sendWindowEnd } : {}),
        ...(parsed.sendDays !== undefined ? { sendDays: parsed.sendDays } : {}),
        ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
        ...(parsed.dailyLimit !== undefined ? { dailyLimit: parsed.dailyLimit } : {}),
        ...(parsed.stopOnReply !== undefined ? { stopOnReply: parsed.stopOnReply } : {}),
        ...(parsed.openTracking !== undefined ? { openTracking: parsed.openTracking } : {}),
        ...(parsed.linkTracking !== undefined ? { linkTracking: parsed.linkTracking } : {}),
        ...(parsed.sendIntervalMinutes !== undefined ? { sendIntervalMinutes: parsed.sendIntervalMinutes } : {}),
        ...(parsed.stopOnClick !== undefined ? { stopOnClick: parsed.stopOnClick } : {}),
        ...(parsed.stopOnOpen !== undefined ? { stopOnOpen: parsed.stopOnOpen } : {}),
        ...(parsed.plainTextMode !== undefined ? { plainTextMode: parsed.plainTextMode } : {}),
        ...(parsed.followUpPercent !== undefined ? { followUpPercent: parsed.followUpPercent } : {}),
      },
    });

    if (parsed.recipients?.length) {
      const leadIds = await upsertRecipientsAsLeads(db, userId, parsed.recipients);
      await linkRecipients(db, userId, campaign.id, leadIds);
    }

    res.json({ campaign: toClientCampaign(campaign) });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** DELETE /api/campaigns/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const existing = await db.campaign.findFirst({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
    return;
  }
  await db.campaign.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * GET /api/campaigns/:id/recipients — list this campaign's recipients joined
 * with their lead details. `?format=csv` returns a CSV download (backs the
 * "Download CSV" button in CampaignsListView).
 */
router.get('/:id/recipients', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const campaign = await db.campaign.findFirst({ where: { id: req.params.id } });
  if (!campaign) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
    return;
  }

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: 'asc' },
  });
  const leads = await db.lead.findMany({ where: { id: { in: recipients.map((r) => r.leadId) } } });
  const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));

  const rows = recipients.map((r) => {
    const lead = leadById.get(r.leadId);
    return {
      id: r.id,
      leadId: r.leadId,
      email: lead?.email ?? '',
      name: lead?.name ?? '',
      company: lead?.company ?? '',
      status: r.status,
      currentStep: r.currentStep,
      attemptCount: r.attemptCount,
      lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
      lastError: r.lastError,
    };
  });

  if (req.query.format === 'csv') {
    const header = 'email,name,company,status,currentStep,attemptCount,lastSentAt,lastError';
    const lines = rows.map((r) =>
      [r.email, r.name, r.company, r.status, r.currentStep, r.attemptCount, r.lastSentAt ?? '', r.lastError ?? '']
        .map((v) => csvEscape(String(v)))
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${campaign.name.replace(/[^a-z0-9_-]+/gi, '_')}_recipients.csv"`,
    );
    res.send([header, ...lines].join('\n'));
    return;
  }

  res.json({ recipients: rows });
});

/** POST /api/campaigns/:id/recipients — add recipients to an existing campaign. */
router.post('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const db = tenantDb(userId);
    const campaign = await db.campaign.findFirst({ where: { id: req.params.id } });
    if (!campaign) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
      return;
    }

    const body = z.object({ recipients: z.array(recipientSchema).min(1) }).parse(req.body);
    const leadIds = await upsertRecipientsAsLeads(db, userId, body.recipients);
    await linkRecipients(db, userId, campaign.id, leadIds);

    res.status(201).json({ ok: true, added: leadIds.length });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** DELETE /api/campaigns/:id/recipients/:recipientId — remove (skip) a recipient. */
router.delete('/:id/recipients/:recipientId', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const recipient = await db.campaignRecipient.findFirst({
    where: { id: req.params.recipientId, campaignId: req.params.id },
  });
  if (!recipient) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Recipient not found' });
    return;
  }
  await db.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: RecipientStatus.SKIPPED, lastError: 'Removed by user' },
  });
  res.json({ ok: true });
});

export default router;
