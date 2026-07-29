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
import { verifyTrackingToken, verifyClickToken, verifyAddressUnsubscribeToken } from './trackingToken.js';
import { stopRecipientForEvent } from './engine.js';
import { enforceDnc } from '../leads/dnc.js';
import { suppress } from '../leads/suppression.js';

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

  // Verify the click token against BOTH the recipientId AND the decoded target.
  // A token signed for target A will NOT verify when replayed with target B,
  // closing the open-redirect hole. isSafeHttpUrl remains as defence-in-depth.
  const recipientId = verifyClickToken(req.params.token, target);
  if (!recipientId) {
    res.status(404).send('Invalid or expired tracking link');
    return;
  }

  try {
    const recipient = await loadRecipient(recipientId);
    if (!recipient) {
      res.status(404).send('Invalid or expired tracking link');
      return;
    }

    let targetHost = '';
    try {
      targetHost = new URL(target).hostname;
    } catch {}
    logger.info({ recipientId: recipient.id, campaignId: recipient.campaignId, targetHost, target }, 'Click-tracking redirect verified');

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

    res.redirect(302, target);
  } catch (err) {
    logger.error({ err }, 'Click-tracking redirect failed');
    res.status(500).send('Tracking redirect failed');
  }
});

// ── One-click unsubscribe ─────────────────────────────────────────────────────
// GET renders a human-facing confirmation *form* — it mutates NOTHING.
// Corporate mail gateways (Microsoft Defender Safe Links, Proofpoint URL
// Defense, etc.) issue an automated GET against every URL in an inbound
// message for reputation scanning. If GET performed the unsubscribe, those
// prefetch requests would silently DNC leads who never clicked anything.
//
// POST is the RFC 8058 List-Unsubscribe-Post target that mail providers hit
// programmatically, and the action the confirmation form submits to. Only
// POST actually mutates the lead.

const UNSUB_PAGE = (message: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080b14;color:#e2e8f0;font-family:system-ui,sans-serif">
<div style="max-width:420px;padding:40px;text-align:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px">
<h1 style="font-size:20px;margin:0 0 12px">${message}</h1>
<p style="font-size:14px;color:#94a3b8;margin:0">You will not receive further emails from this sender.</p>
</div></body></html>`;

// Renders a "click to confirm" form whose action POSTs to the same token URL.
// Shown by GET so that human-facing clicks arrive at a real confirmation
// step, not an immediate mutation that a link scanner could also trigger.
const UNSUB_CONFIRM_FORM = (token: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080b14;color:#e2e8f0;font-family:system-ui,sans-serif">
<div style="max-width:420px;padding:40px;text-align:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px">
<h1 style="font-size:20px;margin:0 0 12px">Unsubscribe</h1>
<p style="font-size:14px;color:#94a3b8;margin:0 0 24px">Click the button below to confirm you no longer want to receive these emails.</p>
<form method="POST" action="/t/u/${token}">
  <button type="submit" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:12px 28px;font-size:15px;cursor:pointer">Confirm unsubscribe</button>
</form>
</div></body></html>`;

/**
 * Opt out by address, for links minted by the one-off send paths (no
 * CampaignRecipient row exists to resolve).
 *
 * Writes to the Suppression list FIRST and unconditionally: that record is
 * keyed on the address and survives the Lead being deleted, so it is the part
 * that must not depend on a lead existing. Flipping the Lead to DNC (and
 * running enforceDnc to tear down queued sends) is best-effort on top, for the
 * common case where the address is in the CRM.
 */
async function unsubscribeByAddress(userId: string, email: string): Promise<boolean> {
  await suppress(userId, email, 'UNSUBSCRIBE');

  const lead = await prisma.lead.findFirst({
    where: { userId, email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, status: true },
  });

  if (lead) {
    if (lead.status !== LeadStatus.DNC) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: LeadStatus.DNC } });
    }
    await enforceDnc(userId, lead as any);
  }

  logger.info({ userId, hasLead: Boolean(lead) }, 'Address unsubscribed via one-click link');
  return true;
}

async function unsubscribeByToken(token: string): Promise<boolean> {
  // Address-scoped token (one-off sends). Tried first and independently: the
  // two token families are domain-separated in the HMAC, so exactly one can
  // ever verify.
  const address = verifyAddressUnsubscribeToken(token);
  if (address) return unsubscribeByAddress(address.userId, address.email);

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

/**
 * GET /t/u/:token — human-facing link from the email footer.
 *
 * READ-ONLY: verifies the token and renders a confirmation form. The form
 * POSTs back to this same URL; only that POST mutates the lead. This keeps
 * automated link-scanner prefetches (Safe Links, Proofpoint, etc.) harmless.
 */
router.get('/u/:token', async (req: Request, res: Response) => {
  try {
    // Verify the token is structurally valid (signed, not tampered) without
    // touching the lead — we just want to know if the link is legit enough
    // to show a confirmation form vs. an error page.
    const valid =
      Boolean(verifyAddressUnsubscribeToken(req.params.token)) ||
      Boolean(verifyTrackingToken(req.params.token));
    if (!valid) {
      res.status(404).send(UNSUB_PAGE('This unsubscribe link is invalid or expired'));
      return;
    }
    res.status(200).send(UNSUB_CONFIRM_FORM(req.params.token));
  } catch (err) {
    logger.error({ err }, 'Unsubscribe (GET) failed');
    res.status(500).send(UNSUB_PAGE('Something went wrong — please try again'));
  }
});

/**
 * POST /t/u/:token — RFC 8058 List-Unsubscribe-Post target (mail-provider
 * initiated) and the action for the human-facing confirmation form above.
 *
 * Returns HTML so a human who submitted the form sees a proper confirmation
 * page. Mail providers issuing the one-click POST discard the body, so the
 * HTML response is invisible to them — only the 200 status code matters.
 */
router.post('/u/:token', async (req: Request, res: Response) => {
  try {
    const ok = await unsubscribeByToken(req.params.token);
    if (!ok) {
      // Token was invalid/expired — mail providers get a 404 (idempotent
      // failure), humans see a readable error page.
      res.status(404).send(UNSUB_PAGE('This unsubscribe link is invalid or expired'));
      return;
    }
    res.status(200).send(UNSUB_PAGE("You've been unsubscribed"));
  } catch (err) {
    logger.error({ err }, 'Unsubscribe (POST) failed');
    res.status(500).send(UNSUB_PAGE('Something went wrong — please try again'));
  }
});

export default router;
