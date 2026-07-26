// FILE: server/src/scraper/routes.ts

import express, { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { tenantDb } from '../db/tenantDb.js';
import { requireUserId } from '../auth/middleware.js';
import { logger } from '../logger.js';
import {
  startJob,
  getJob,
  listJobs,
  cancelJob,
  publicJob,
  downloadCsv,
  isConfigured,
  activeJobFor,
  syncAndScanReleasable,
  syncAndApplyRelease,
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

// ── Qualification criteria ──────────────────────────────────────────────────
// What counts as a lead — mirrors scraper/criteria.py's Criteria dataclass
// field-for-field (see ScraperSettings in prisma/schema.prisma). Values are
// clamped here with the SAME bounds criteria.py's _clamp() enforces, so a
// value that somehow bypasses this route (a hand-edited settings.json) is
// still bounded on the Python side — belt and suspenders, not redundant: this
// clamp protects Postgres/the UI, criteria.py's protects the crawl itself.

const CRITERIA_CLAMP_BOUNDS: Record<string, [number, number]> = {
  minSubs: [0, 2_000_000],
  maxSubs: [0, 2_000_000],
  recentDays: [1, 365],
  minAvgViews: [0, 1_000_000],
  minLongformRatio: [0, 1],
  longformMinSecs: [1, 3600],
  searchResults: [5, 200],
  uploadsSample: [3, 50],
  faceCheckSample: [0, 10],
  recheckDays: [1, 365],
  keywordsPerAutoRun: [1, 20],
};

// Fields whose blacklist gate is threshold-tunable (see main.py's
// run_gauntlet), used to decide which changed fields belong in the PATCH
// response's `loosened` list.
const LOOSENING_DIRECTION: Record<string, 'lower' | 'higher'> = {
  minSubs: 'lower',
  maxSubs: 'higher',
  minAvgViews: 'lower',
  minLongformRatio: 'lower',
};

// Every clamped field except minLongformRatio maps to a Prisma `Int` column.
// A decimal reaching one of those (a number input happily yields "1000.5")
// makes Prisma throw a validation error, so they are rounded here rather than
// clamped-but-still-fractional.
const CRITERIA_FLOAT_FIELDS = new Set(['minLongformRatio']);

const MAX_SIGNAL_TERMS = 60;
const MAX_TERM_LEN = 40;
// score() in main.py matches by substring — a term shorter than this
// false-positives constantly ("app" inside "happy"). Terms containing "."
// (domains like "stan.store") are exempt — see criteria.py's identical rule.
const MIN_TERM_LEN = 4;

function clampNumeric(field: string, value: number): number {
  const [lo, hi] = CRITERIA_CLAMP_BOUNDS[field];
  if (!Number.isFinite(value)) return lo;
  const bounded = Math.min(hi, Math.max(lo, value));
  return CRITERIA_FLOAT_FIELDS.has(field) ? bounded : Math.round(bounded);
}

function sanitizeSignalList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of raw) {
    const t = term.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    if (t.length > MAX_TERM_LEN) continue;
    if (t.length < MIN_TERM_LEN && !t.includes('.')) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SIGNAL_TERMS) break;
  }
  return out;
}

const SCRAPER_SETTINGS_DEFAULTS = {
  minSubs: 1_000,
  maxSubs: 50_000,
  recentDays: 15,
  minAvgViews: 1_000,
  minLongformRatio: 0.40,
  longformMinSecs: 60,
  searchResults: 50,
  uploadsSample: 15,
  faceCheckSample: 3,
  recheckDays: 30,
  strongSignals: [] as string[],
  weakSignals: [] as string[],
  keywordsPerAutoRun: 4,
};

type ScraperSettingsShape = typeof SCRAPER_SETTINGS_DEFAULTS;

function publicSettings(row: Partial<ScraperSettingsShape> | null): ScraperSettingsShape {
  if (!row) return { ...SCRAPER_SETTINGS_DEFAULTS };
  return {
    minSubs: row.minSubs ?? SCRAPER_SETTINGS_DEFAULTS.minSubs,
    maxSubs: row.maxSubs ?? SCRAPER_SETTINGS_DEFAULTS.maxSubs,
    recentDays: row.recentDays ?? SCRAPER_SETTINGS_DEFAULTS.recentDays,
    minAvgViews: row.minAvgViews ?? SCRAPER_SETTINGS_DEFAULTS.minAvgViews,
    minLongformRatio: row.minLongformRatio ?? SCRAPER_SETTINGS_DEFAULTS.minLongformRatio,
    longformMinSecs: row.longformMinSecs ?? SCRAPER_SETTINGS_DEFAULTS.longformMinSecs,
    searchResults: row.searchResults ?? SCRAPER_SETTINGS_DEFAULTS.searchResults,
    uploadsSample: row.uploadsSample ?? SCRAPER_SETTINGS_DEFAULTS.uploadsSample,
    faceCheckSample: row.faceCheckSample ?? SCRAPER_SETTINGS_DEFAULTS.faceCheckSample,
    recheckDays: row.recheckDays ?? SCRAPER_SETTINGS_DEFAULTS.recheckDays,
    strongSignals: row.strongSignals ?? SCRAPER_SETTINGS_DEFAULTS.strongSignals,
    weakSignals: row.weakSignals ?? SCRAPER_SETTINGS_DEFAULTS.weakSignals,
    keywordsPerAutoRun: row.keywordsPerAutoRun ?? SCRAPER_SETTINGS_DEFAULTS.keywordsPerAutoRun,
  };
}

/** Which changed fields loosened a blacklist-gating threshold — i.e. would
 * plausibly release currently-blacklisted channels. Signal-list growth is
 * reported too, but its release path is a separate opt-in flag (see
 * release_blacklist.py's --include-signal-gate): it can't be verified
 * per-channel the way the numeric gates can. */
function detectLoosened(before: ScraperSettingsShape, after: ScraperSettingsShape): string[] {
  const loosened: string[] = [];
  for (const [field, direction] of Object.entries(LOOSENING_DIRECTION)) {
    const b = before[field as keyof ScraperSettingsShape] as number;
    const a = after[field as keyof ScraperSettingsShape] as number;
    if (a === b) continue;
    if ((direction === 'lower' && a < b) || (direction === 'higher' && a > b)) {
      loosened.push(field);
    }
  }
  // Signal lists need care: an EMPTY list does not mean "no signals accepted",
  // it means "fall back to criteria.py's built-in vocabulary" (40 strong + 17
  // weak). So an empty list is not comparable term-by-term against an explicit
  // one, and a naive "does `after` contain a term `before` lacked?" test reads
  // a deliberate NARROWING (defaults -> a short hand-typed list) as a widening,
  // and then offers to release every no_signals channel — which would re-crawl
  // thousands of channels that still fail the gate. Only the two cases we can
  // actually judge count as loosened.
  const beforeIsDefaults = before.strongSignals.length === 0 && before.weakSignals.length === 0;
  const afterIsDefaults = after.strongSignals.length === 0 && after.weakSignals.length === 0;
  if (!beforeIsDefaults) {
    if (afterIsDefaults) {
      // Explicit list cleared → back to the built-in vocabulary, which is
      // larger than any realistic hand-typed list. Treat as a widening.
      loosened.push('signals');
    } else {
      const beforeSignals = new Set([...before.strongSignals, ...before.weakSignals]);
      const afterSignals = [...after.strongSignals, ...after.weakSignals];
      if (afterSignals.some((s) => !beforeSignals.has(s))) loosened.push('signals');
    }
  }
  return loosened;
}

const patchSettingsSchema = z.object({
  minSubs: z.number().optional(),
  maxSubs: z.number().optional(),
  recentDays: z.number().optional(),
  minAvgViews: z.number().optional(),
  minLongformRatio: z.number().optional(),
  longformMinSecs: z.number().optional(),
  searchResults: z.number().optional(),
  uploadsSample: z.number().optional(),
  faceCheckSample: z.number().optional(),
  recheckDays: z.number().optional(),
  strongSignals: z.array(z.string()).optional(),
  weakSignals: z.array(z.string()).optional(),
  keywordsPerAutoRun: z.number().optional(),
});

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const row = await tenantDb(userId).scraperSettings.findUnique({ where: { userId } });
    res.json(publicSettings(row));
  } catch (err: any) {
    res.status(500).json({ code: 'UNKNOWN', message: err?.message ?? 'Failed to load settings' });
  }
});

router.patch('/settings', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  let parsed: z.infer<typeof patchSettingsSchema>;
  try {
    parsed = patchSettingsSchema.parse(req.body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid payload';
    res.status(400).json({ code: 'VALIDATION', message });
    return;
  }

  try {
    const existingRow = await tenantDb(userId).scraperSettings.findUnique({ where: { userId } });
    const before = publicSettings(existingRow);

    const clampedPatch: Record<string, unknown> = {};
    for (const field of Object.keys(CRITERIA_CLAMP_BOUNDS)) {
      const value = (parsed as Record<string, unknown>)[field];
      if (value !== undefined) clampedPatch[field] = clampNumeric(field, value as number);
    }
    if (parsed.strongSignals !== undefined) clampedPatch.strongSignals = sanitizeSignalList(parsed.strongSignals);
    if (parsed.weakSignals !== undefined) clampedPatch.weakSignals = sanitizeSignalList(parsed.weakSignals);

    // minSubs/maxSubs must stay ordered — same rule as criteria.py's _clamp().
    const nextMin = (clampedPatch.minSubs as number | undefined) ?? before.minSubs;
    const nextMax = (clampedPatch.maxSubs as number | undefined) ?? before.maxSubs;
    if (nextMax < nextMin) {
      if (clampedPatch.maxSubs !== undefined) clampedPatch.maxSubs = nextMin;
      else clampedPatch.minSubs = nextMax;
    }

    const row = await tenantDb(userId).scraperSettings.upsert({
      where: { userId },
      update: clampedPatch,
      create: { userId, ...SCRAPER_SETTINGS_DEFAULTS, ...clampedPatch },
    });
    const after = publicSettings(row);

    const loosened = detectLoosened(before, after);
    let releasable = 0;
    if (loosened.length > 0 && isConfigured()) {
      try {
        const scan = await syncAndScanReleasable(userId, loosened.includes('signals'));
        releasable = scan?.releasable ?? 0;
      } catch (err: any) {
        logger.error({ err, userId }, 'settings dry-run release scan failed');
        // Settings still saved successfully — the scan is informational, so a
        // scan failure shouldn't roll back or mask the save.
      }
    }

    res.json({ settings: after, loosened, releasable });
  } catch (err: any) {
    logger.error({ err, userId }, 'failed to save scraper settings');
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Failed to save settings' });
  }
});

router.post('/settings/release', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  if (activeJobFor(userId)) {
    res.status(409).json({ code: 'CONFLICT', message: 'A scrape is currently running — try again once it finishes' });
    return;
  }
  const includeSignalGate = Boolean(req.body?.includeSignalGate);
  try {
    const result = await syncAndApplyRelease(userId, includeSignalGate);
    res.json({
      released: result.released ?? 0,
      byReason: result.by_reason ?? {},
      backup: result.backup ?? null,
    });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Release failed' });
  }
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
