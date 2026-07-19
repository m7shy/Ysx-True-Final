import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { requireClientCtx } from '../auth/clientMiddleware.js';
import { logActivity } from './activity.js';
import { sendPortalEmail } from './mailer.js';
import { FAQ_ITEMS, CONTACT_INFO, BANK_TRANSFER_INSTRUCTIONS } from './content.js';

/**
 * Client-facing portal API. Mounted behind requireClientAuth. IDOR rule:
 * every query filters by req.clientAuth.clientId in the WHERE clause — the
 * token alone never selects rows, so a crafted :id can only ever 404.
 */

const router = express.Router();

const revisionSchema = z.object({ note: z.string().trim().min(1, 'Tell us what to change') });
const messageSchema = z.object({ body: z.string().trim().min(1, 'Message body is required') });
const requestSchema = z.object({
  title: z.string().trim().min(1, 'A short title is required'),
  details: z.string().trim().optional(),
});

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({ code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') });
}

/** GET /api/portal/me */
router.get('/me', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const client = await prisma.client.findFirst({
    where: { id: ctx.clientId, userId: ctx.userId },
    select: { id: true, name: true, companyName: true },
  });
  if (!client) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Account not found' });
    return;
  }
  res.json({ clientUser: { id: ctx.clientUserId, email: ctx.email }, client });
});

/** GET /api/portal/projects?status=ACTIVE|ARCHIVED — dashboard cards. */
router.get('/projects', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const status = req.query.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';

  const projects = await prisma.project.findMany({
    where: { clientId: ctx.clientId, userId: ctx.userId, status },
    orderBy: { updatedAt: 'desc' },
    include: {
      activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { summary: true, createdAt: true } },
      revisions: { where: { status: 'SUBMITTED' }, select: { id: true } },
    },
  });

  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      stage: p.stage,
      progressPct: p.progressPct,
      etaAt: p.etaAt,
      waitingOnClient: p.waitingOnClient,
      waitingOnClientNote: p.waitingOnClientNote,
      awaitingApprovalCount: p.revisions.length,
      lastActivity: p.activities[0] ?? null,
      updatedAt: p.updatedAt,
    })),
  });
});

/** GET /api/portal/projects/:id — the project detail page's single payload. */
router.get('/projects/:id', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId },
    include: {
      fileLinks: { orderBy: [{ type: 'asc' }, { label: 'asc' }, { version: 'desc' }] },
      revisions: { orderBy: { roundNumber: 'desc' } },
      messages: { orderBy: { createdAt: 'asc' } },
      activities: { orderBy: { createdAt: 'desc' }, take: 30 },
    },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }
  res.json({ project });
});

/** POST /api/portal/projects/:id/revisions — request a revision round. */
router.post('/projects/:id/revisions', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const project = await prisma.project.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const last = await prisma.revision.findFirst({
    where: { projectId: project.id },
    orderBy: { roundNumber: 'desc' },
  });

  const revision = await prisma.revision.create({
    data: {
      projectId: project.id,
      roundNumber: (last?.roundNumber ?? 0) + 1,
      note: parsed.data.note,
    },
  });
  await logActivity(project.id, 'REVISION_REQUESTED', `Revision round ${revision.roundNumber} requested`);
  logger.info({ projectId: project.id, revisionId: revision.id }, 'Client requested revision');
  res.status(201).json({ revision });
});

/** POST /api/portal/projects/:id/revisions/:revisionId/approve — client sign-off. */
router.post('/projects/:id/revisions/:revisionId/approve', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const existing = await prisma.revision.findFirst({
    where: { id: req.params.revisionId, projectId: project.id },
  });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Revision not found' });
    return;
  }
  if (existing.status !== 'SUBMITTED') {
    res.status(409).json({ code: 'CONFLICT', message: 'Only a delivered revision can be approved' });
    return;
  }

  const revision = await prisma.revision.update({
    where: { id: existing.id },
    data: { status: 'APPROVED' },
  });
  await logActivity(project.id, 'REVISION_APPROVED', `Revision round ${revision.roundNumber} approved`);
  res.json({ revision });
});

/** POST /api/portal/projects/:id/messages — client message to the team. */
router.post('/projects/:id/messages', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const project = await prisma.project.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId },
    include: { client: { select: { name: true } } },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      authorType: 'CLIENT',
      authorLabel: project.client.name,
      body: parsed.data.body,
    },
  });
  await logActivity(project.id, 'MESSAGE_POSTED', `New message from ${project.client.name}`);
  res.status(201).json({ message });
});

/**
 * POST /api/portal/requests — "Start New Project". No Project row is created;
 * the agency gets an email and follows up. Response reassures the client.
 */
router.post('/requests', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const owner = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
  if (owner) {
    try {
      await sendPortalEmail(ctx.userId, {
        to: owner.email,
        subject: `New project request: ${parsed.data.title}`,
        text: `Portal client ${ctx.email} requested a new project.\n\nTitle: ${parsed.data.title}\n\nDetails:\n${parsed.data.details ?? '(none)'}\n`,
      });
    } catch (err) {
      logger.error({ err, clientUserId: ctx.clientUserId }, 'Project request email failed');
    }
  }
  res.status(201).json({ ok: true, message: "Request received — we'll get back to you within one business day." });
});

/** GET /api/portal/invoices — list with outstanding balance. */
router.get('/invoices', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const invoices = await prisma.invoice.findMany({
    where: { clientId: ctx.clientId, userId: ctx.userId, status: { not: 'DRAFT' } },
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { id: true, name: true } },
      payments: { include: { receipt: true } },
    },
  });

  const outstandingCents = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'VIEWED' || i.status === 'OVERDUE')
    .reduce((sum, i) => sum + i.amountCents, 0);

  res.json({ invoices, outstandingCents });
});

/** GET /api/portal/invoices/:id — detail; first view flips SENT → VIEWED. */
router.get('/invoices/:id', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  let invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId, status: { not: 'DRAFT' } },
    include: {
      project: { select: { id: true, name: true } },
      payments: { include: { receipt: true } },
    },
  });
  if (!invoice) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
    return;
  }

  if (invoice.status === 'SENT') {
    invoice = {
      ...invoice,
      ...(await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'VIEWED', viewedAt: invoice.viewedAt ?? new Date() },
      })),
    };
  }

  res.json({ invoice, paymentInstructions: BANK_TRANSFER_INSTRUCTIONS });
});

/** GET /api/portal/faq — static, config-driven. */
router.get('/faq', (_req: Request, res: Response) => {
  res.json({ faq: FAQ_ITEMS, contact: CONTACT_INFO });
});

export default router;
