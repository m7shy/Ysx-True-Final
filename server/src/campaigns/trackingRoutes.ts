// FILE: server/src/campaigns/trackingRoutes.ts
//
// Public (unauthenticated) open-pixel and click-redirect endpoints, mounted
// at /t in index.ts — BEFORE the JWT auth middleware chain, since the
// recipient's mail client has no session. HMAC-signed tokens
// (trackingToken.ts) stand in for auth: they can't be forged or enumerated.

import express, { Request, Response } from 'express';
import { LeadStatus, TrackingEventType } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { verifyTrackingToken } from './trackingToken.js';
import { stopRecipientForEvent } from './engine.js';
import { enforceDnc } from '../leads/dnc.js';

const router = express.Router();

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64',
);

const OPEN_DEDUPE_WINDOW_MS = 5 * 60_000;

async function loadRecipient(recipientId: string) {
  return prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, campaignId: true, leadId: true, userId: true },
  });
}

/** GET /t/o/:token — 1x1 tracking pixel. Always returns the GIF, even for a bad/expired token. */
router.get('/o/:token', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const recipientId = verifyTrackingToken(req.params.token);
    if (recipientId) {
      const recipient = await loadRecipient(recipientId);
      if (recipient) {
        const recent = await prisma.trackingEvent.findFirst({
          where: {
            leadId: recipient.leadId,
            campaignId: recipient.campaignId,
            type: TrackingEventType.OPENED,
            createdAt: { gte: new Date(Date.now() - OPEN_DEDUPE_WINDOW_MS) },
          },
        });
        if (!recent) {
          await prisma.trackingEvent.create({
            data: {
              userId: recipient.userId,
              leadId: recipient.leadId,
              campaignId: recipient.campaignId,
              type: TrackingEventType.OPENED,
              meta: { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null },
            },
          });
          await stopRecipientForEvent(recipient.id, 'OPENED');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Open-tracking pixel failed');
  }

  res.status(200).end(TRANSPARENT_GIF);
});

function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** GET /t/c/:token?u=<base64url original url> — records CLICKED then redirects. */
router.get('/c/:token', async (req: Request, res: Response) => {
  const encoded = typeof req.query.u === 'string' ? req.query.u : '';
  let target: string | null = null;
  try {
    target = encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : null;
  } catch {
    target = null;
  }

  if (!target || !isSafeHttpUrl(target)) {
    res.status(400).send('Invalid tracking link');
    return;
  }

  try {
    const recipientId = verifyTrackingToken(req.params.token);
    if (recipientId) {
      const recipient = await loadRecipient(recipientId);
      if (recipient) {
        await prisma.trackingEvent.create({
          data: {
            userId: recipient.userId,
            leadId: recipient.leadId,
            campaignId: recipient.campaignId,
            type: TrackingEventType.CLICKED,
            meta: { url: target, userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null },
          },
        });
        await prisma.campaign.update({
          where: { id: recipient.campaignId },
          data: { clickedCount: { increment: 1 } },
        });
        await stopRecipientForEvent(recipient.id, 'CLICKED');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Click-tracking redirect failed');
  }

  res.redirect(302, target);
});

// ── One-click unsubscribe ─────────────────────────────────────────────────────
// GET renders a confirmation page for humans clicking the footer link; POST is
// the RFC 8058 one-click endpoint mail providers hit from the List-Unsubscribe
// header. Both flip the lead to DNC and enforce it (cancel scheduled
// follow-ups, skip pending campaign recipients). Idempotent.

const UNSUB_PAGE = (message: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080b14;color:#e2e8f0;font-family:system-ui,sans-serif">
<div style="max-width:420px;padding:40px;text-align:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px">
<h1 style="font-size:20px;margin:0 0 12px">${message}</h1>
<p style="font-size:14px;color:#94a3b8;margin:0">You will not receive further emails from this sender.</p>
</div></body></html>`;

async function unsubscribeByToken(token: string): Promise<boolean> {
  const recipientId = verifyTrackingToken(token);
  if (!recipientId) return false;
  const recipient = await loadRecipient(recipientId);
  if (!recipient) return false;

  const lead = await prisma.lead.findUnique({
    where: { id: recipient.leadId },
    select: { id: true, email: true, status: true },
  });
  if (!lead) return false;

  if (lead.status !== LeadStatus.DNC) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: LeadStatus.DNC } });
  }
  await enforceDnc(recipient.userId, lead);
  logger.info({ leadId: lead.id }, 'Lead unsubscribed via one-click link');
  return true;
}

/** GET /t/u/:token — human-facing unsubscribe link from the email footer. */
router.get('/u/:token', async (req: Request, res: Response) => {
  try {
    const ok = await unsubscribeByToken(req.params.token);
    if (!ok) {
      res.status(404).send(UNSUB_PAGE('This unsubscribe link is invalid or expired'));
      return;
    }
    res.status(200).send(UNSUB_PAGE("You've been unsubscribed"));
  } catch (err) {
    logger.error({ err }, 'Unsubscribe (GET) failed');
    res.status(500).send(UNSUB_PAGE('Something went wrong — please try again'));
  }
});

/** POST /t/u/:token — RFC 8058 one-click unsubscribe (mail-provider initiated). */
router.post('/u/:token', async (req: Request, res: Response) => {
  try {
    const ok = await unsubscribeByToken(req.params.token);
    res.status(ok ? 200 : 404).end();
  } catch (err) {
    logger.error({ err }, 'Unsubscribe (POST) failed');
    res.status(500).end();
  }
});

export default router;
