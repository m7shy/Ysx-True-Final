// FILE: server/src/scraper/routes.ts

import express, { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { tenantDb } from '../db/tenantDb.js';
import { requireUserId } from '../auth/middleware.js';
import {
  startJob,
  getJob,
  listJobs,
  cancelJob,
  publicJob,
  downloadCsv,
  isConfigured,
} from './service.js';
import {
  listCookieFiles,
  saveCookieFile,
  deleteCookieFile,
} from './cookieService.js';
import { computeNextRunTime } from './autoScheduler.js';

/**
 * In-app YouTube scraper API (tenant-scoped). Mounted behind requireAuth +
 * requireActiveTenant in index.ts, so req.auth.userId is always the logged-in
 * tenant and every job is created / read for that tenant only.
 *
 *   GET    /api/scraper            → { configured, activeJobId }
 *   POST   /api/scraper/jobs       → start a run  { keywords: string[], importToCrm?: boolean }
 *   GET    /api/scraper/jobs       → this tenant's runs (newest first)
 *   GET    /api/scraper/jobs/:id   → one run's status + live log + summary
 *   GET    /api/scraper/jobs/:id/download → this run's newly-scraped rows as a .csv
 *   POST   /api/scraper/jobs/:id/cancel → stop a running job
 *   GET    /api/scraper/auto       → this tenant's auto-scrape schedule
 *   PATCH  /api/scraper/auto       → update { enabled?, runsPerDay? } (3 or 5)
 *   GET    /api/scraper/cookies         → list the YouTube cookie rotation pool
 *   POST   /api/scraper/cookies         → upload one or more .txt cookie files
 *   DELETE /api/scraper/cookies/:name   → remove one cookie file from the pool
 */

const router = express.Router();

// Cookie files are tiny Netscape jars; keep them in memory and cap hard so a
// bad upload can't exhaust RAM. Field name "files" matches the frontend form.
const cookieUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 20 },
});

/** Run the multer middleware, converting its errors into clean 400 JSON. */
function acceptCookieFiles(req: Request, res: Response, next: express.NextFunction) {
  cookieUpload.array('files')(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError
          ? `Upload rejected: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Upload failed';
      res.status(400).json({ code: 'VALIDATION', message });
      return;
    }
    next();
  });
}

const startSchema = z.object({
  // Accept either a string[] or a newline/comma blob from a textarea.
  keywords: z.union([z.array(z.string()), z.string()]),
  // When false, scraped rows are never written into the CRM — only kept for
  // /jobs/:id/download so the user can review/qualify before importing.
  // Defaults to true (existing behavior).
  importToCrm: z.boolean().optional(),
});

function normalizeKeywords(input: string[] | string): string[] {
  const arr = Array.isArray(input) ? input : input.split(/[\n,]/);
  return arr.map((k) => k.trim()).filter(Boolean);
}

router.get('/', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const active = listJobs(userId).find((j) => j.status === 'running');
  res.json({ configured: isConfigured(), activeJobId: active?.id ?? null });
});

router.post('/jobs', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  let parsed: z.infer<typeof startSchema>;
  try {
    parsed = startSchema.parse(req.body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid payload';
    res.status(400).json({ code: 'VALIDATION', message });
    return;
  }

  try {
    const job = await startJob(userId, normalizeKeywords(parsed.keywords), parsed.importToCrm ?? true);
    res.status(202).json({ job: publicJob(job) });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Failed to start scrape' });
  }
});

router.get('/jobs', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  res.json({ jobs: listJobs(userId).map(publicJob) });
});

router.get('/jobs/:id', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const job = getJob(userId, req.params.id);
  if (!job) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found' });
    return;
  }
  res.json({ job: publicJob(job) });
});

router.get('/jobs/:id/download', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const job = getJob(userId, req.params.id);
  if (!job) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found' });
    return;
  }
  const csv = downloadCsv(job);
  if (!csv) {
    res.status(409).json({ code: 'NOT_READY', message: 'This run has no downloadable results' });
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scrape-${job.id}.csv"`);
  res.send(csv);
});

router.post('/jobs/:id/cancel', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const ok = cancelJob(userId, req.params.id);
  if (!ok) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'No running job with that id' });
    return;
  }
  res.json({ ok: true });
});

function publicSchedule(row: {
  enabled: boolean;
  runsPerDay: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastRunSummary: unknown;
} | null) {
  if (!row) return { enabled: false, runsPerDay: 3, nextRunAt: null, lastRunAt: null, lastRunSummary: null };
  return {
    enabled: row.enabled,
    runsPerDay: row.runsPerDay,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunSummary: row.lastRunSummary,
  };
}

router.get('/auto', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const row = await tenantDb(userId).scraperSchedule.findUnique({ where: { userId } });
  res.json(publicSchedule(row));
});

const patchAutoSchema = z.object({
  enabled: z.boolean().optional(),
  runsPerDay: z.union([z.literal(3), z.literal(5)]).optional(),
});

router.patch('/auto', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  let parsed: z.infer<typeof patchAutoSchema>;
  try {
    parsed = patchAutoSchema.parse(req.body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid payload';
    res.status(400).json({ code: 'VALIDATION', message });
    return;
  }

  const runsPerDay = parsed.runsPerDay ?? 3;

  const row = await tenantDb(userId).scraperSchedule.upsert({
    where: { userId },
    update: {
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      ...(parsed.runsPerDay !== undefined
        ? { runsPerDay: parsed.runsPerDay, nextRunAt: computeNextRunTime(new Date(), parsed.runsPerDay) }
        : {}),
    },
    create: {
      userId,
      enabled: parsed.enabled ?? true,
      runsPerDay,
      nextRunAt: computeNextRunTime(new Date(), runsPerDay),
    },
  });

  res.json(publicSchedule(row));
});

// ── Cookie rotation pool ──────────────────────────────────────────────────────
// Per-tenant pool (CookieFile.userId): each tenant sees/manages its own
// uploads plus legacy pre-scoping rows (userId=null) — see cookieService.ts.

router.get('/cookies', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    res.json({ files: await listCookieFiles(userId) });
  } catch (err: any) {
    res.status(500).json({ code: 'UNKNOWN', message: err?.message ?? 'Failed to list cookies' });
  }
});

router.post('/cookies', acceptCookieFiles, async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ code: 'VALIDATION', message: 'No cookie files uploaded' });
    return;
  }
  try {
    const userId = requireUserId(req);
    for (const f of files) {
      await saveCookieFile(userId, f.originalname, f.buffer);
    }
    res.status(201).json({ files: await listCookieFiles(userId) });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Upload failed' });
  }
});

router.delete('/cookies/:name', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    await deleteCookieFile(userId, req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Delete failed' });
  }
});

export default router;
