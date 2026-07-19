import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { tenantDb } from '../db/tenantDb.js';
import { logger } from '../logger.js';
import { requireUserId } from '../auth/middleware.js';
import { logActivity } from '../portal/activity.js';
import { sendPortalEmail, portalBaseUrl } from '../portal/mailer.js';

/**
 * Admin-side invoicing. Concepts are deliberately separated: an Invoice is the
 * request for payment, a Payment records money received (any provider), and a
 * Receipt is the client-visible proof. MVP provider = BANK_TRANSFER with
 * manual mark-paid; other providers slot in as new PaymentMethod values.
 */

const router = express.Router();

const lineItem = z.object({ label: z.string().trim().min(1), amountCents: z.number().int().min(0) });

const createSchema = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  amountCents: z.number().int().positive('amountCents must be positive'),
  currency: z.string().trim().toLowerCase().length(3).default('usd'),
  dueAt: z.coerce.date().optional(),
  lineItems: z.array(lineItem).optional(),
  notes: z.string().trim().optional(),
});

const patchSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  lineItems: z.array(lineItem).optional(),
  notes: z.string().trim().nullable().optional(),
  status: z.enum(['CANCELLED']).optional(), // other transitions use dedicated endpoints
});

const markPaidSchema = z.object({
  reference: z.string().trim().optional(),
  amountCents: z.number().int().positive().optional(), // defaults to invoice total
});

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({ code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') });
}

/** Next sequential per-tenant number with the given prefix (INV-0007 / RCPT-0007). */
async function nextNumber(userId: string, prefix: 'INV' | 'RCPT'): Promise<string> {
  const count =
    prefix === 'INV'
      ? await prisma.invoice.count({ where: { userId } })
      : await prisma.receipt.count({ where: { payment: { invoice: { userId } } } });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

/** GET /api/invoices?clientId= */
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
  const invoices = await tenantDb(userId).invoice.findMany({
    where: clientId ? { clientId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      client: { select: { id: true, name: true, companyName: true } },
      project: { select: { id: true, name: true } },
      payments: { include: { receipt: true } },
    },
  });
  res.json({ invoices });
});

/** POST /api/invoices — created as DRAFT. */
router.post('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const client = await tenantDb(userId).client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Client not found' });
    return;
  }
  if (parsed.data.projectId) {
    const project = await tenantDb(userId).project.findUnique({ where: { id: parsed.data.projectId } });
    if (!project || project.clientId !== client.id) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found for this client' });
      return;
    }
  }

  const invoice = await tenantDb(userId).invoice.create({
    data: {
      userId,
      clientId: client.id,
      projectId: parsed.data.projectId ?? null,
      number: await nextNumber(userId, 'INV'),
      amountCents: parsed.data.amountCents,
      currency: parsed.data.currency,
      dueAt: parsed.data.dueAt ?? null,
      lineItemsJson: parsed.data.lineItems ?? undefined,
      notes: parsed.data.notes ?? null,
    },
  });
  logger.info({ userId, invoiceId: invoice.id }, 'Invoice created');
  res.status(201).json({ invoice });
});

/** PATCH /api/invoices/:id — edit a DRAFT/SENT invoice, or cancel. */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const existing = await tenantDb(userId).invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
    return;
  }
  if (existing.status === 'PAID') {
    res.status(409).json({ code: 'CONFLICT', message: 'A paid invoice cannot be edited' });
    return;
  }

  const { lineItems, ...rest } = parsed.data;
  const invoice = await tenantDb(userId).invoice.update({
    where: { id: existing.id },
    data: { ...rest, ...(lineItems ? { lineItemsJson: lineItems } : {}) },
  });
  res.json({ invoice });
});

/** POST /api/invoices/:id/send — DRAFT → SENT + notify the client by email. */
router.post('/:id/send', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const existing = await tenantDb(userId).invoice.findUnique({
    where: { id: req.params.id },
    include: { client: { include: { clientUsers: { select: { email: true } } } } },
  });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
    return;
  }
  if (existing.status !== 'DRAFT' && existing.status !== 'SENT') {
    res.status(409).json({ code: 'CONFLICT', message: `Cannot send an invoice in status ${existing.status}` });
    return;
  }

  const invoice = await tenantDb(userId).invoice.update({
    where: { id: existing.id },
    data: { status: 'SENT', sentAt: existing.sentAt ?? new Date() },
  });

  const recipients = existing.client.clientUsers.map((u) => u.email);
  if (recipients.length > 0) {
    const amount = (invoice.amountCents / 100).toFixed(2);
    const due = invoice.dueAt ? ` — due ${invoice.dueAt.toISOString().slice(0, 10)}` : '';
    try {
      await sendPortalEmail(userId, {
        to: recipients.join(', '),
        subject: `Invoice ${invoice.number} from YSX Visuals`,
        text: `A new invoice is ready in your client portal.\n\nInvoice ${invoice.number}: ${amount} ${invoice.currency.toUpperCase()}${due}\n\nView it and see payment details here:\n${portalBaseUrl()}/invoices\n`,
      });
    } catch (err) {
      // The status change stands; email is best-effort and the portal shows it anyway.
      logger.error({ err, invoiceId: invoice.id }, 'Invoice notification email failed');
    }
  }

  if (invoice.projectId) {
    await logActivity(invoice.projectId, 'INVOICE_SENT', `Invoice ${invoice.number} issued`);
  }
  res.json({ invoice });
});

/** POST /api/invoices/:id/mark-paid — records Payment + Receipt, SENT/VIEWED/OVERDUE → PAID. */
router.post('/:id/mark-paid', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = markPaidSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);

  const existing = await tenantDb(userId).invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
    return;
  }
  if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
    res.status(409).json({ code: 'CONFLICT', message: `Invoice is already ${existing.status}` });
    return;
  }

  const payment = await prisma.payment.create({
    data: {
      invoiceId: existing.id,
      method: 'BANK_TRANSFER',
      amountCents: parsed.data.amountCents ?? existing.amountCents,
      reference: parsed.data.reference ?? null,
      markedPaidByAdmin: true,
      receipt: { create: { number: await nextNumber(userId, 'RCPT') } },
    },
    include: { receipt: true },
  });

  const invoice = await tenantDb(userId).invoice.update({
    where: { id: existing.id },
    data: { status: 'PAID', paidAt: new Date() },
  });

  if (invoice.projectId) {
    await logActivity(invoice.projectId, 'INVOICE_PAID', `Invoice ${invoice.number} paid — thank you`);
  }
  logger.info({ userId, invoiceId: invoice.id, paymentId: payment.id }, 'Invoice marked paid');
  res.json({ invoice, payment });
});

export default router;
