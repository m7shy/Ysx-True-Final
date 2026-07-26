import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { tenantDb } from '../db/tenantDb.js';
import { logger } from '../logger.js';
import { requireUserId } from '../auth/middleware.js';
import { createLoginToken } from '../portal/tokens.js';
import { sendPortalEmail, portalBaseUrl } from '../portal/mailer.js';

/**
 * Admin-side client management (CRM views). Client rows are tenant-scoped via
 * tenantDb; ClientUser rows are reached only through an owned Client.
 */

const router = express.Router();

const createSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  companyName: z.string().trim().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  companyName: z.string().trim().nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
});

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({ code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') });
}

/** GET /api/clients — list, newest first, with portal-user + project counts. */
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const clients = await tenantDb(userId).client.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      clientUsers: { select: { id: true, email: true, lastLoginAt: true, passwordHash: true } },
      _count: { select: { projects: true, invoices: true } },
    },
  });
  res.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      companyName: c.companyName,
      status: c.status,
      createdAt: c.createdAt,
      projectCount: c._count.projects,
      invoiceCount: c._count.invoices,
      portalUsers: c.clientUsers.map((u) => ({
        id: u.id,
        email: u.email,
        lastLoginAt: u.lastLoginAt,
        hasPassword: Boolean(u.passwordHash),
      })),
    })),
  });
});

/** POST /api/clients */
router.post('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const client = await tenantDb(userId).client.create({
    data: { name: parsed.data.name, companyName: parsed.data.companyName ?? null, userId },
  });
  logger.info({ userId, clientId: client.id }, 'Client created');
  res.status(201).json({ client });
});

/** PATCH /api/clients/:id */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  try {
    const client = await tenantDb(userId).client.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ client });
  } catch {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Client not found' });
  }
});

/**
 * POST /api/clients/:id/invite — create (or reuse) the ClientUser for an email
 * and send a portal invite (set-password link). Re-inviting an existing user
 * just issues a fresh link.
 */
router.post('/:id/invite', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const client = await tenantDb(userId).client.findUnique({ where: { id: req.params.id } });
  if (!client) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Client not found' });
    return;
  }

  const { email } = parsed.data;
  // Portal emails are unique PER AGENCY, not globally: the same address may
  // legitimately have portal access at another agency (a shared ops@ inbox, a
  // freelancer working with several). Only a collision inside THIS tenant is a
  // conflict — previously the global constraint rejected the cross-tenant case
  // too, permanently locking the second agency out of inviting that address.
  const existing = await prisma.clientUser.findUnique({ where: { userId_email: { userId, email } } });
  if (existing && existing.clientId !== client.id) {
    // Already attached to a DIFFERENT client of this same agency — re-homing
    // via invite would silently move them between the agency's own clients.
    res.status(409).json({ code: 'EMAIL_TAKEN', message: 'This email already has portal access for another of your clients' });
    return;
  }

  const clientUser =
    existing ??
    (await prisma.clientUser.create({ data: { clientId: client.id, userId, email } }));

  try {
    const raw = await createLoginToken(clientUser.id, 'INVITE');
    const link = `${portalBaseUrl()}/set-password?token=${raw}`;
    await sendPortalEmail(userId, {
      to: email,
      subject: `Your ${client.companyName || client.name} project portal is ready`,
      text: `Hi,\n\nYou've been invited to the YSX Visuals client portal, where you can track your project, files, and invoices in one place.\n\nSet your password and sign in here (link valid for 7 days):\n\n${link}\n\nSee you inside.`,
    });
  } catch (err: any) {
    logger.error({ err, clientUserId: clientUser.id }, 'Failed to send portal invite');
    const status = err?.status === 409 ? 409 : 502;
    res.status(status).json({
      code: err?.code === 'NO_MAILBOX' ? 'NO_MAILBOX' : 'SEND_FAILED',
      message:
        err?.code === 'NO_MAILBOX'
          ? err.message
          : 'Invite email could not be sent — check your connected mailbox and retry',
    });
    return;
  }

  logger.info({ userId, clientUserId: clientUser.id }, 'Portal invite sent');
  res.status(201).json({ clientUser: { id: clientUser.id, email: clientUser.email } });
});

/**
 * POST /api/clients/:id/portal-users/:clientUserId/revoke — bump the target
 * ClientUser's tokenVersion so every outstanding portal session (access +
 * refresh) for that person stops verifying immediately. Resolved through the
 * owning Client exactly like invite above, so one tenant can never revoke
 * another tenant's client users even by guessing a clientUserId.
 */
router.post('/:id/portal-users/:clientUserId/revoke', async (req: Request, res: Response) => {
  const userId = requireUserId(req);

  const client = await tenantDb(userId).client.findUnique({ where: { id: req.params.id } });
  if (!client) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Client not found' });
    return;
  }

  const clientUser = await prisma.clientUser.findUnique({ where: { id: req.params.clientUserId } });
  if (!clientUser || clientUser.clientId !== client.id) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Portal user not found' });
    return;
  }

  await prisma.clientUser.update({
    where: { id: clientUser.id },
    data: { tokenVersion: { increment: 1 } },
  });

  logger.info({ userId, clientUserId: clientUser.id }, 'Portal user session revoked');
  res.json({ ok: true });
});

export default router;
