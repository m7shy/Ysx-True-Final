// FILE: server/src/leads/routes.ts

import express, { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { requireUserId } from '../auth/middleware.js';
import { enforceDnc } from './dnc.js';
import { suppress } from './suppression.js';

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

// ── CSV export / import ──────────────────────────────────────────────────────
// Both registered BEFORE /:id so the literal paths win the route match.
// The frontend service (services/leadsApi.ts) has called these paths since the
// lead-CRUD refactor; the backend halves were never landed until now.

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  const isFormula = /^[=+\-@\t\r]/.test(s);
  const formatted = isFormula ? `'${s}` : s;
  const needsQuotes = isFormula || /[",\n]/.test(formatted);
  return needsQuotes ? `"${formatted.replace(/"/g, '""')}"` : formatted;
}

/** GET /api/leads/export — all of the tenant's leads as leads.csv. */
router.get('/export', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const leads = await prisma.lead.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

  const header = ['name', 'email', 'company', 'status', 'source', 'score', 'notes', 'lastContacted', 'createdAt'];
  const lines = [header.join(',')];
  for (const l of leads) {
    lines.push([
      csvEscape(l.name),
      csvEscape(l.email),
      csvEscape(l.company),
      csvEscape(l.status),
      csvEscape(l.source),
      csvEscape(l.score),
      csvEscape(l.notes),
      csvEscape(l.lastContacted?.toISOString()),
      csvEscape(l.createdAt.toISOString()),
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(lines.join('\n') + '\n');
});

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

/** Minimal RFC-4180 parser (quoted fields, embedded commas/newlines). */
function parseCsv(text: string): Array<Record<string, string>> {
  const rawRows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rawRows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rawRows.push(row); }
  if (rawRows.length < 2) return [];

  const header = rawRows[0].map((h) => h.trim().toLowerCase());
  return rawRows.slice(1)
    .filter((r) => r.some((v) => v.trim().length > 0))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });
}

/**
 * POST /api/leads/import-csv — multipart upload (field "file"), header row
 * required; recognizes name/email/company/source/notes/score columns. Upserts
 * by email within the tenant: existing leads get their empty fields filled,
 * never overwritten.
 */
router.post('/import-csv', csvUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const file = req.file;
    if (!file || file.buffer.length === 0) {
      res.status(400).json({ code: 'VALIDATION', message: 'A non-empty CSV file is required' });
      return;
    }

    const rows = parseCsv(file.buffer.toString('utf8'));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (const [i, raw] of rows.entries()) {
      const email = (raw.email ?? '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped++;
        errors.push({ row: i + 2, message: 'Missing or invalid email' });
        continue;
      }
      const name = (raw.name ?? '').trim() || email.split('@')[0];
      const score = raw.score && Number.isFinite(Number(raw.score)) ? Math.round(Number(raw.score)) : undefined;

      try {
        const existing = await prisma.lead.findUnique({ where: { userId_email: { userId, email } } });
        if (existing) {
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              name: existing.name || name,
              company: existing.company || raw.company || undefined,
              source: existing.source || raw.source || undefined,
              notes: existing.notes || raw.notes || undefined,
              score: existing.score ?? score,
            },
          });
          updated++;
        } else {
          await prisma.lead.create({
            data: {
              userId,
              name,
              email,
              company: raw.company || undefined,
              source: raw.source || 'CSV Import',
              notes: raw.notes || undefined,
              score,
              status: LeadStatus.NEW,
            },
          });
          created++;
        }
      } catch (err) {
        skipped++;
        errors.push({ row: i + 2, message: err instanceof Error ? err.message : 'Row failed' });
      }
    }

    res.json({ created, updated, skipped, total: rows.length, errors: errors.slice(0, 20) });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
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

/**
 * POST /api/leads/:id/erase — GDPR Art 17 erasure.
 *
 * Deliberately NOT the same thing as DELETE above. A plain delete removes the
 * lead and, with it, every record that this person ever asked not to be
 * contacted — so the next scraper run re-imports them and the sequence starts
 * again. That is the opposite of what an erasure request means.
 *
 * Erasure therefore does two things in one step:
 *   1. records the opt-out as a HASH on the suppression list, which is the
 *      only thing that survives, and holds no personal data;
 *   2. deletes the Lead, which cascades its TrackingEvents and
 *      CampaignRecipient rows.
 *
 * Order matters: suppression is written FIRST. If the delete fails we have
 * over-suppressed, which harms nobody; if the delete succeeded and the
 * suppression write then failed, we would have destroyed the evidence of the
 * request while leaving the address free to be re-imported.
 */
router.post('/:id/erase', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const existing = await prisma.lead.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    return;
  }

  await suppress(userId, existing.email, 'ERASURE');
  await prisma.lead.delete({ where: { id: existing.id } });

  logger.info({ userId, leadId: existing.id }, 'Lead erased on request; address suppressed by hash');
  res.json({
    ok: true,
    erased: true,
    // Reported so an operator answering the request can say what happened
    // without going to the database. Deliberately does not echo the address.
    note: 'Lead and its tracking history deleted. A one-way hash of the address is retained so it can never be re-imported or contacted.',
  });
});

export default router;
