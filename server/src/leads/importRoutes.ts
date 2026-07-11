// FILE: server/src/leads/importRoutes.ts

import express, { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { config } from '../config.js';
import { importLeadRows, scraperRowSchema } from './importService.js';

/**
 * Server-to-server lead import for the standalone headless scraper CLI
 * (YT-Scraper/crm_importer.py).
 *
 * Mounted at POST /api/leads/import BEFORE the JWT-gated /api/leads router in
 * index.ts, so it does NOT run requireAuth. The CLI has no browser session;
 * instead it presents a shared secret in the `X-Import-Key` header, which is
 * timing-safe compared against config.IMPORT_API_KEY. On success every row is
 * written into config.IMPORT_TENANT_ID's namespace via importLeadRows().
 *
 * NOTE: the in-app "Scraper" view does NOT come through here — it spawns the
 * scraper server-side and calls importLeadRows() directly for the logged-in
 * tenant (see scraper/service.ts). This route only exists for the legacy CLI.
 *
 * Idempotent by (tenant, email): see importService.ts.
 */

const router = express.Router();

/** Constant-time secret comparison that also tolerates unequal lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Gate: valid X-Import-Key → resolve the fixed import tenant onto req.auth. */
function requireImportKey(req: Request, res: Response, next: NextFunction): void {
  const key = config.IMPORT_API_KEY;
  const tenantId = config.IMPORT_TENANT_ID;
  if (!key || !tenantId) {
    res.status(503).json({ code: 'IMPORT_DISABLED', message: 'Lead import is not configured on this server' });
    return;
  }

  const provided = req.headers['x-import-key'];
  if (typeof provided !== 'string' || !safeEqual(provided, key)) {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or missing X-Import-Key' });
    return;
  }

  req.auth = { userId: tenantId, email: 'scraper@import' };
  next();
}

const importSchema = z.object({
  // Run-level context applied to every row that doesn't carry its own `niche`.
  niche: z.string().optional(),
  leads: z.array(scraperRowSchema).min(1, 'at least one lead is required'),
});

/**
 * POST /api/leads/import
 * Body: { niche?: string, leads: ScraperRow[] }
 * Returns: { created, updated, skipped, total, errors: [{ email, message }] }
 */
router.post('/', requireImportKey, async (req: Request, res: Response) => {
  const userId = config.IMPORT_TENANT_ID as string;

  let payload: z.infer<typeof importSchema>;
  try {
    payload = importSchema.parse(req.body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid payload';
    res.status(400).json({ code: 'VALIDATION', message });
    return;
  }

  const summary = await importLeadRows(userId, payload.leads, payload.niche);
  res.status(200).json(summary);
});

export default router;
