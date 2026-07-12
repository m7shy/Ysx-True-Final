// FILE: server/src/leads/routes.ts

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { requireUserId } from '../auth/middleware.js';
import { enforceDnc } from './dnc.js';

/**
 * Leads CRUD (tenant-scoped). Mounted behind requireAuth in index.ts, so
 * req.auth.userId is always set; every query is filtered by it so one tenant
 * can never read/write another tenant's leads.
 */

const router = express.Router();

const LEAD_STATUSES = Object.values(LeadStatus) as [string, ...string[]];

const createSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().trim().toLowerCase().email('a valid email is required'),
  company: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  score: z.number().int().optional(),
  intelligence: z.record(z.any()).optional(),
});

const updateSchema = createSchema.partial();

function toErrorPayload(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof z.ZodError) {
    return { status: 400, code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { status: 500, code: 'UNKNOWN', message };
}

/** GET /api/leads — list the tenant's leads, newest first. */
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const leads = await prisma.lead.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ leads });
});

/** GET /api/leads/:id */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const lead = await prisma.lead.findFirst({ where: { id: req.params.id, userId } });
  if (!lead) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    return;
  }
  res.json({ lead });
});

/** POST /api/leads — create a lead. 409 if this tenant already has this email. */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const parsed = createSchema.parse(req.body);

    const existing = await prisma.lead.findUnique({
      where: { userId_email: { userId, email: parsed.email } },
    });
    if (existing) {
      res.status(409).json({ code: 'EMAIL_TAKEN', message: 'A lead with this email already exists' });
      return;
    }

    const lead = await prisma.lead.create({
      data: {
        userId,
        name: parsed.name,
        email: parsed.email,
        company: parsed.company,
        status: (parsed.status as LeadStatus) ?? LeadStatus.NEW,
        source: parsed.source,
        notes: parsed.notes,
        score: parsed.score,
        intelligence: parsed.intelligence,
      },
    });
    res.status(201).json({ lead });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** PATCH /api/leads/:id */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const parsed = updateSchema.parse(req.body);

    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
      return;
    }

    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.company !== undefined ? { company: parsed.company } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status as LeadStatus } : {}),
        ...(parsed.source !== undefined ? { source: parsed.source } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.score !== undefined ? { score: parsed.score } : {}),
        ...(parsed.intelligence !== undefined ? { intelligence: parsed.intelligence } : {}),
      },
    });

    if (parsed.status === LeadStatus.DNC && existing.status !== LeadStatus.DNC) {
      await enforceDnc(userId, lead);
    }

    res.json({ lead });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

/** DELETE /api/leads/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const existing = await prisma.lead.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    return;
  }
  await prisma.lead.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
