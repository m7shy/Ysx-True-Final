// FILE: server/src/campaigns/trackingRoutes.ts
//
// Public (unauthenticated) open-pixel and click-redirect endpoints, mounted
// at /t in index.ts — BEFORE the JWT auth middleware chain, since the
// recipient's mail client has no session. HMAC-signed tokens
// (trackingToken.ts) stand in for auth: they can't be forged or enumerated.

import express, { Request, Response } from 'express';
import { TrackingEventType } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { verifyTrackingToken } from './trackingToken.js';
import { stopRecipientForEvent } from './engine.js';

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

export default router;
