import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { tenantDb } from '../db/tenantDb.js';
import { logger } from '../logger.js';
import { requireUserId } from '../auth/middleware.js';
import { logActivity } from '../portal/activity.js';

/**
 * Admin-side project management. Project rows are tenant-scoped via tenantDb;
 * child rows (FileLink/Revision/Message/ActivityEvent) carry no userId, so
 * every child mutation first resolves the project through the tenant-scoped
 * client — an unowned projectId 404s before any child row is touched.
 */

const router = express.Router();

const STAGES = ['ONBOARDING', 'EDITING', 'REVISION', 'FINAL_DELIVERY', 'COMPLETE'] as const;

const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  ONBOARDING: 'Onboarding',
  EDITING: 'Editing',
  REVISION: 'Revision',
  FINAL_DELIVERY: 'Final Delivery',
  COMPLETE: 'Complete',
};

const createSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1, 'name is required'),
  scopeSummary: z.string().trim().optional(),
  etaAt: z.coerce.date().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  stage: z.enum(STAGES).optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  etaAt: z.coerce.date().nullable().optional(),
  nextStepNote: z.string().trim().nullable().optional(),
  waitingOnClient: z.boolean().optional(),
  waitingOnClientNote: z.string().trim().nullable().optional(),
  scopeSummary: z.string().trim().nullable().optional(),
});

const fileSchema = z.object({
  type: z.enum(['BRAND_ASSET', 'FILE_LINK', 'DELIVERABLE']).default('FILE_LINK'),
  label: z.string().trim().min(1, 'label is required'),
  // Zod's .url() accepts any syntactically valid URI, including javascript: and
  // data: — both of which would execute as XSS when the portal renders the href.
  // The .refine() step restricts the stored scheme to the safe web-only set.
  url: z
    .string()
    .trim()
    .url('A valid URL is required')
    .refine(
      (v) => {
        try {
          const { protocol } = new URL(v);
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'URL must use http or https' }
    ),
});

const revisionPatchSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED']).optional(),
  respondedNote: z.string().trim().nullable().optional(),
});

const messageSchema = z.object({ body: z.string().trim().min(1, 'Message body is required') });

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({ code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') });
}

/** Resolve a project only if it belongs to the tenant; null otherwise. */
async function ownedProject(userId: string, projectId: string) {
  return tenantDb(userId).project.findUnique({ where: { id: projectId } });
}

/** GET /api/projects?status=ACTIVE|ARCHIVED */
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const status = req.query.status === 'ARCHIVED' ? 'ARCHIVED' : req.query.status === 'ACTIVE' ? 'ACTIVE' : undefined;
  const projects = await tenantDb(userId).project.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: 'desc' },
    include: {
      client: { select: { id: true, name: true, companyName: true } },
      _count: { select: { revisions: true, messages: true, fileLinks: true } },
    },
  });
  res.json({ projects });
});

/** POST /api/projects */
router.post('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const client = await tenantDb(userId).client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Client not found' });
    return;
  }

  const project = await tenantDb(userId).project.create({
    data: {
      userId,
      clientId: client.id,
      name: parsed.data.name,
      scopeSummary: parsed.data.scopeSummary ?? null,
      etaAt: parsed.data.etaAt ?? null,
    },
  });
  await logActivity(project.id, 'PROJECT_CREATED', `Project "${project.name}" kicked off`);
  logger.info({ userId, projectId: project.id }, 'Project created');
  res.status(201).json({ project });
});

/** GET /api/projects/:id — full detail with all portal-visible children. */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const project = await tenantDb(userId).project.findUnique({
    where: { id: req.params.id },
    include: {
      client: { select: { id: true, name: true, companyName: true } },
      fileLinks: { orderBy: [{ type: 'asc' }, { label: 'asc' }, { version: 'desc' }] },
      revisions: { orderBy: { roundNumber: 'desc' } },
      messages: { orderBy: { createdAt: 'asc' } },
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      invoices: { select: { id: true, number: true, status: true, amountCents: true, dueAt: true } },
    },
  });
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }
  res.json({ project });
});

/** PATCH /api/projects/:id — stage/progress/eta/notes/waiting-on-client/scope. */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const before = await ownedProject(userId, req.params.id);
  if (!before) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const project = await tenantDb(userId).project.update({
    where: { id: before.id },
    data: parsed.data,
  });

  if (parsed.data.stage && parsed.data.stage !== before.stage) {
    await logActivity(project.id, 'STAGE_CHANGED', `Moved to ${STAGE_LABELS[parsed.data.stage]}`);
  }
  if (parsed.data.waitingOnClient === true && !before.waitingOnClient) {
    await logActivity(
      project.id,
      'WAITING_ON_CLIENT',
      parsed.data.waitingOnClientNote?.trim()
        ? `Waiting on you: ${parsed.data.waitingOnClientNote.trim()}`
        : 'Waiting on input from you'
    );
  }
  res.json({ project });
});

/** POST /api/projects/:id/archive */
router.post('/:id/archive', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const before = await ownedProject(userId, req.params.id);
  if (!before) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }
  const project = await tenantDb(userId).project.update({
    where: { id: before.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  await logActivity(project.id, 'PROJECT_ARCHIVED', 'Project archived');
  res.json({ project });
});

/** POST /api/projects/:id/files — add an external file link (auto-versioned per label). */
router.post('/:id/files', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = fileSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const project = await ownedProject(userId, req.params.id);
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const prior = await prisma.fileLink.findFirst({
    where: { projectId: project.id, label: parsed.data.label, type: parsed.data.type },
    orderBy: { version: 'desc' },
  });

  const file = await prisma.fileLink.create({
    data: {
      projectId: project.id,
      type: parsed.data.type,
      label: parsed.data.label,
      url: parsed.data.url,
      version: (prior?.version ?? 0) + 1,
      addedByAdmin: true,
    },
  });
  await logActivity(
    project.id,
    'FILE_ADDED',
    file.version > 1 ? `New version of "${file.label}" (v${file.version})` : `Added "${file.label}"`
  );
  res.status(201).json({ file });
});

/** DELETE /api/projects/:id/files/:fileId */
router.delete('/:id/files/:fileId', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const project = await ownedProject(userId, req.params.id);
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }
  const deleted = await prisma.fileLink.deleteMany({
    where: { id: req.params.fileId, projectId: project.id },
  });
  if (deleted.count !== 1) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'File not found' });
    return;
  }
  res.json({ ok: true });
});

/** PATCH /api/projects/:id/revisions/:revisionId — respond / move status. */
router.patch('/:id/revisions/:revisionId', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = revisionPatchSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const project = await ownedProject(userId, req.params.id);
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

  const revision = await prisma.revision.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  if (parsed.data.status && parsed.data.status !== existing.status) {
    const summary =
      parsed.data.status === 'SUBMITTED'
        ? `Revision round ${revision.roundNumber} delivered — awaiting your review`
        : parsed.data.status === 'IN_PROGRESS'
          ? `Revision round ${revision.roundNumber} in progress`
          : `Revision round ${revision.roundNumber} ${parsed.data.status.toLowerCase()}`;
    await logActivity(project.id, 'REVISION_UPDATED', summary);
  }
  res.json({ revision });
});

/** POST /api/projects/:id/messages — admin message to the client. */
router.post('/:id/messages', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const project = await ownedProject(userId, req.params.id);
  if (!project) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found' });
    return;
  }

  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      authorType: 'ADMIN',
      authorLabel: 'YSX Visuals',
      body: parsed.data.body,
    },
  });
  await logActivity(project.id, 'MESSAGE_POSTED', 'New message from the team');
  res.status(201).json({ message });
});

export default router;
