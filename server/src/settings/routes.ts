// FILE: server/src/settings/routes.ts
//
// Tenant-owned settings that the SERVER acts on, as opposed to the UI-only
// preferences kept in User.settings. Right now that means one thing: the legal
// sender identity every commercial email must carry.

import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { requireUserId } from '../auth/middleware.js';
import { DEFAULT_PROVENANCE } from '../campaigns/trackedHtml.js';

const router = express.Router();

const identitySchema = z.object({
  // A postal address is the thing CAN-SPAM actually requires, so it gets a
  // length floor that a placeholder like "-" or "n/a" cannot clear. This is a
  // guard against the field being satisfied rather than filled in; it cannot
  // and does not try to validate that an address is real.
  businessName: z.string().trim().min(2, 'Business name is required').max(200),
  businessAddress: z
    .string()
    .trim()
    .min(10, 'Enter a full postal address — street, city, postcode, country')
    .max(500),
  // null / '' → fall back to DEFAULT_PROVENANCE at render time. A tenant may
  // reword the disclosure; they may not remove it.
  senderProvenance: z.string().trim().max(500).nullable().optional(),
});

/** GET /api/settings/sender-identity */
router.get('/sender-identity', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { businessName: true, businessAddress: true, senderProvenance: true },
  });
  if (!user) {
    res.status(401).json({ code: 'AUTH', message: 'Account no longer exists' });
    return;
  }

  res.json({
    businessName: user.businessName ?? '',
    businessAddress: user.businessAddress ?? '',
    senderProvenance: user.senderProvenance ?? '',
    defaultProvenance: DEFAULT_PROVENANCE,
    // The UI needs to be able to say "campaigns are blocked until you fill
    // this in" rather than leaving the operator to discover it from a stalled
    // campaign.
    configured: Boolean(user.businessName?.trim() && user.businessAddress?.trim()),
  });
});

/** PUT /api/settings/sender-identity */
router.put('/sender-identity', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const parsed = identitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION',
      message: parsed.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const provenance = parsed.data.senderProvenance?.trim();
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      businessName: parsed.data.businessName,
      businessAddress: parsed.data.businessAddress,
      // Empty string means "use the default", stored as null so the fallback
      // has one representation rather than two.
      senderProvenance: provenance ? provenance : null,
    },
    select: { businessName: true, businessAddress: true, senderProvenance: true },
  });

  logger.info({ userId }, 'Sender identity updated');
  res.json({
    businessName: user.businessName,
    businessAddress: user.businessAddress,
    senderProvenance: user.senderProvenance ?? '',
    defaultProvenance: DEFAULT_PROVENANCE,
    configured: true,
  });
});

export default router;
