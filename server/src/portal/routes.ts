import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
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
// Bounded on purpose: each submission emails the agency owner through the
// owner's own metered mailbox — the same quota the CRM's campaign sending
// draws on — so an unbounded body was a way for one client to burn it.
const requestSchema = z.object({
  title: z.string().trim().min(1, 'A short title is required').max(200, 'Title is too long'),
  details: z.string().trim().max(5000, 'Details are too long').optional(),
});

/**
 * Whether a Prisma error is a unique-constraint violation on the given index.
 * Matched structurally rather than with `instanceof PrismaClientKnownRequestError`
 * so this keeps working across the client regenerations this repo does on every
 * schema change (see .plans/known-failures.md on the two @prisma/client installs).
 */
function isUniqueViolation(err: unknown, target: string): boolean {
  if (!err || typeof err !== 'object' || (err as any).code !== 'P2002') return false;
  const meta = (err as any).meta?.target;
  const fields = Array.isArray(meta) ? meta.join(',') : String(meta ?? '');
  return fields.includes(target);
}

// Rounds are allocated by reading the current max and adding one, which two
// concurrent submissions can do simultaneously. @@unique([projectId,
// roundNumber]) turns that from a silent duplicate into a caught conflict, and
// re-reading the max resolves it — the loser of the race simply takes the next
// number. Bounded because a caller stuck in this loop is no longer racing, it is
// failing, and should be told so rather than retried indefinitely.
const REVISION_ROUND_ATTEMPTS = 5;

/** Allocate the next revision round for a project, retrying on the round collision. Exported for tests. */
export async function createNextRevision(projectId: string, note: string) {
  for (let attempt = 0; attempt < REVISION_ROUND_ATTEMPTS; attempt++) {
    const last = await prisma.revision.findFirst({
      where: { projectId },
      orderBy: { roundNumber: 'desc' },
    });

    try {
      return await prisma.revision.create({
        data: { projectId, roundNumber: (last?.roundNumber ?? 0) + 1, note },
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'roundNumber')) throw err;
      logger.warn(
        { projectId, attempt: attempt + 1 },
        'Revision round collided with a concurrent request; retrying with a fresh max',
      );
    }
  }
  logger.error({ projectId }, 'Gave up allocating a revision round after repeated collisions');
  return null;
}

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
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId, status: 'ACTIVE' },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const revision = await createNextRevision(project.id, parsed.data.note);
  if (!revision) {
    res.status(409).json({
      code: 'CONFLICT',
      message: 'Could not allocate a revision round just now. Please try again.',
    });
    return;
  }
  await logActivity(project.id, 'REVISION_REQUESTED', `Revision round ${revision.roundNumber} requested`);
  logger.info({ projectId: project.id, revisionId: revision.id }, 'Client requested revision');
  res.status(201).json({ revision });
});

/** POST /api/portal/projects/:id/revisions/:revisionId/approve — client sign-off. */
router.post('/projects/:id/revisions/:revisionId/approve', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId, status: 'ACTIVE' },
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
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId, status: 'ACTIVE' },
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
// Keyed on the authenticated clientUserId, NOT the IP: the caller is already
// authenticated, so identity is the thing to bound — and an IP key would both
// let one client rotate address to escape it and lump several clients behind
// one office NAT into a shared budget. Each submission spends one unit of the
// tenant's paid email quota, so this is a spend limit as much as a spam limit.
const requestLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.clientAuth?.clientUserId ?? 'anonymous',
  message: { code: 'RATE_LIMITED', message: 'Too many requests — please try again later' },
});

router.post('/requests', requestLimiter, async (req: Request, res: Response) => {
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
    where: { clientId: ctx.clientId, userId: ctx.userId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { id: true, name: true } },
      payments: { include: { receipt: true } },
    },
  });

  // Outstanding = invoice total MINUS what has already been paid against it.
  //
  // This used to sum amountCents alone, so any invoice carrying a part-payment
  // told the client they still owed the whole amount. Latent today only because
  // mark-paid currently flips an invoice straight to PAID whatever it is paid —
  // the moment part-payments are recorded properly this becomes a wrong number
  // on a screen a paying customer reads. `payments` is already fetched above,
  // so netting it off costs nothing.
  const outstandingCents = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'VIEWED' || i.status === 'OVERDUE')
    .reduce((sum, i) => {
      const paid = i.payments.reduce((p, payment) => p + payment.amountCents, 0);
      return sum + Math.max(0, i.amountCents - paid);
    }, 0);

  res.json({ invoices, outstandingCents });
});

/** GET /api/portal/invoices/:id — detail; first view flips SENT → VIEWED. */
router.get('/invoices/:id', async (req: Request, res: Response) => {
  const ctx = requireClientCtx(req);
  let invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, clientId: ctx.clientId, userId: ctx.userId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
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
    const updated = await prisma.invoice.updateMany({
      where: { id: invoice.id, clientId: ctx.clientId, userId: ctx.userId, status: 'SENT' },
      data: { status: 'VIEWED', viewedAt: invoice.viewedAt ?? new Date() },
    });
    const refreshed = await prisma.invoice.findFirst({
      where: { id: invoice.id, clientId: ctx.clientId, userId: ctx.userId },
      include: {
        project: { select: { id: true, name: true } },
        payments: { include: { receipt: true } },
      },
    });
    if (refreshed) {
      invoice = refreshed;
    }
  }

  res.json({ invoice, paymentInstructions: BANK_TRANSFER_INSTRUCTIONS });
});

/** GET /api/portal/faq — static, config-driven. */
router.get('/faq', (_req: Request, res: Response) => {
  res.json({ faq: FAQ_ITEMS, contact: CONTACT_INFO });
});

export default router;
