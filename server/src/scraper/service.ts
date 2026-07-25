// FILE: server/src/scraper/service.ts

import { spawn, ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { importLeadRows, scraperRowSchema, ImportSummary } from '../leads/importService.js';
import { materializeCookiePool } from './cookieService.js';

/**
 * In-app YouTube scraper runner.
 *
 * A logged-in CRM user starts a run from the "Scraper" view. For each run we:
 *   1. isolate it under the scraper's per-niche workspace using the tenant id as
 *      the niche (profiles/<slug>/), so one tenant's keywords, blacklist and
 *      leads.csv can never bleed into another's — mirrors SessionProfile.slugify
 *      in session_profile.py;
 *   2. write the user's keywords into that profile's keywords.txt (main.py bails
 *      if a profiled run has none);
 *   3. spawn `PYTHON_BIN main.py --niche <slug>` as a child process, streaming
 *      its stdout/stderr into an in-memory log the frontend polls;
 *   4. on exit, parse profiles/<slug>/leads.csv and upsert the rows straight
 *      into the tenant via importLeadRows() — no HTTP hop, no shared secret.
 *
 * Job state lives in a process-local Map. That's deliberate for the free,
 * single-instance deployment: no queue, no extra service, no database table. The
 * tradeoff is that a backend restart forgets in-flight/finished runs (leads
 * already written survive in Postgres). One active run per tenant is enforced.
 */

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobSource = 'manual' | 'auto';

export interface ScrapeJob {
  id: string;
  userId: string;
  niche: string;
  keywords: string[];
  source: JobSource;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  log: string[];
  summary?: ImportSummary;
  error?: string;
  /** Whether this run's leads were written into the CRM (false = CSV-only). */
  imported?: boolean;
  /** Raw CSV rows (original columns) new to this run — kept for /download regardless of `imported`. */
  rows?: Array<Record<string, string>>;
}

const MAX_LOG_LINES = 800;

const jobs = new Map<string, ScrapeJob>();
const procs = new Map<string, ChildProcess>();

// Global ceiling on concurrent scraper children, across ALL tenants and both
// entry points (manual startJob + auto-scheduler startAutoJob). Each run also
// spawns yt-dlp/curl_cffi work under it, so an unbounded number of tenants
// starting manual runs at once can exhaust the host's RAM even though
// activeJobFor() already caps each tenant to one run. Enforced here (at the
// actual process-spawn boundary) rather than only in autoScheduler.ts, so the
// limit holds regardless of which caller is starting jobs.
const MAX_CONCURRENT_CHILDREN = Number(process.env.SCRAPER_MAX_CONCURRENT ?? 4);
let activeChildCount = 0;

function reserveSlot(): void {
  activeChildCount++;
}

/** Idempotent: safe to call from both the 'error' and 'close' handlers of the same child. */
function releaseSlot(released: { done: boolean }): void {
  if (released.done) return;
  released.done = true;
  activeChildCount--;
}

function assertCapacity(): void {
  if (activeChildCount >= MAX_CONCURRENT_CHILDREN) {
    throw Object.assign(new Error('Scraper is at capacity across all accounts — try again shortly'), {
      code: 'AT_CAPACITY',
      status: 503,
    });
  }
}

/** Public shape (no internal handles); log is trimmed by the route if needed. */
export function publicJob(job: ScrapeJob) {
  return {
    id: job.id,
    status: job.status,
    keywords: job.keywords,
    source: job.source,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    log: job.log,
    summary: job.summary,
    error: job.error,
    imported: job.imported,
    downloadable: Boolean(job.rows && job.rows.length > 0),
  };
}

/**
 * CSV text of a finished job's newly-scraped rows (original columns, as
 * written by Python), or null if the job has nothing to download yet.
 */
export function downloadCsv(job: ScrapeJob): string | null {
  if (!job.rows || job.rows.length === 0) return null;
  const header = Object.keys(job.rows[0]);
  return rowsToCsv(header, job.rows);
}

/** Replicates session_profile.slugify so we can locate the run's output dir. */
function slugify(niche: string): string {
  const slug = (niche || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

export function isConfigured(): boolean {
  return Boolean(config.SCRAPER_DIR);
}

export function getJob(userId: string, id: string): ScrapeJob | undefined {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : undefined;
}

export function listJobs(userId: string): ScrapeJob[] {
  return [...jobs.values()]
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function activeJobFor(userId: string): ScrapeJob | undefined {
  return [...jobs.values()].find((j) => j.userId === userId && j.status === 'running');
}

function appendLog(job: ScrapeJob, chunk: string): void {
  const lines = chunk.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  for (const line of lines) job.log.push(line);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/quotes). */
function parseCsv(text: string): { header: string[]; rows: Array<Record<string, string>> } {
  const rawRows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rawRows.push(row); row = [];
    } else if (c === '\r') {
      // ignore; \n handles the newline
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rawRows.push(row); }

  if (rawRows.length === 0) return { header: [], rows: [] };
  const header = rawRows[0].map((h) => h.trim());
  const rows = rawRows.slice(1)
    .filter((r) => r.some((v) => v.trim().length > 0))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });
  return { header, rows };
}

/** Read the profile's leads.csv, keeping the raw (unvalidated) rows as-written by Python. */
async function readLeadsRaw(leadsPath: string): Promise<{ header: string[]; rows: Array<Record<string, string>> }> {
  let text: string;
  try {
    text = await fs.readFile(leadsPath, 'utf8');
  } catch {
    return { header: [], rows: [] }; // no leads produced this run
  }
  return parseCsv(text);
}

/** Read the profile's leads.csv and coerce each valid row through the schema. */
async function readLeads(leadsPath: string) {
  const { rows } = await readLeadsRaw(leadsPath);
  const out = [];
  for (const raw of rows) {
    if (!(raw.email || '').trim()) continue;
    const parsed = scraperRowSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Serialize raw CSV rows back to text using a fixed header (quoting only where needed). */
function rowsToCsv(header: string[], rows: Array<Record<string, string>>): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.map(escape).join(',')];
  for (const row of rows) lines.push(header.map((h) => escape(row[h] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Shared "child exited" handling for both startJob and startAutoJob: read
 * back leads.csv, diff against the pre-run email set, optionally import
 * (idempotent), and settle the job's final status. Mutates `job` in place.
 *
 * When `importToCrm` is false the fresh rows are never written to Postgres —
 * they're kept on the job (raw, original columns) purely so /jobs/:id/download
 * can serve them. The caller decides at review time whether to bring them into
 * the CRM (e.g. via the existing CSV import route), so nothing here writes a
 * Lead row in that case.
 */
async function finishJob(
  job: ScrapeJob,
  leadsPath: string,
  before: Set<string>,
  code: number | null,
  signal: NodeJS.Signals | null,
  importToCrm: boolean,
): Promise<void> {
  try {
    const { header, rows: rawRows } = await readLeadsRaw(leadsPath);
    const freshRaw = rawRows.filter((r) => (r.email || '').trim() && !before.has(r.email.trim().toLowerCase()));
    job.rows = freshRaw;
    job.imported = importToCrm;

    if (importToCrm) {
      const rows = await readLeads(leadsPath);
      // Import every row (idempotent), but report against the freshly-found set.
      const full = await importLeadRows(job.userId, rows, job.niche);
      job.summary = { ...full, created: freshRaw.length };
      appendLog(job, `✔ imported ${freshRaw.length} new lead(s), refreshed ${full.updated}`);
    } else {
      job.summary = { created: freshRaw.length, updated: 0, skipped: 0, total: rawRows.length, errors: [] };
      appendLog(job, `✔ scraped ${freshRaw.length} new lead(s) — not imported, download the CSV to review`);
    }

    job.status = code === 0 || code === 199 ? 'succeeded' : 'failed';
    if (job.status === 'failed') job.error = `scraper exited with code ${code}${signal ? ` (${signal})` : ''}`;
  } catch (err) {
    logger.error({ err, jobId: job.id }, 'scraper import failed');
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'import failed';
  }
  job.finishedAt = new Date().toISOString();
}

/**
 * Start a scrape for `userId` with the given keywords. Throws if the scraper is
 * not configured, the keyword list is empty, or a run is already active for the
 * tenant. Returns immediately with the running job; work continues in the child.
 */
export async function startJob(userId: string, keywords: string[], importToCrm = true): Promise<ScrapeJob> {
  if (!config.SCRAPER_DIR) {
    throw Object.assign(new Error('Scraper is not configured on this server'), { code: 'SCRAPER_DISABLED', status: 503 });
  }
  const cleanKeywords = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  if (cleanKeywords.length === 0) {
    throw Object.assign(new Error('At least one keyword is required'), { code: 'VALIDATION', status: 400 });
  }
  if (activeJobFor(userId)) {
    throw Object.assign(new Error('A scrape is already running for your account'), { code: 'CONFLICT', status: 409 });
  }
  assertCapacity();

  const niche = `crm-${userId}`;
  const slug = slugify(niche);
  const scraperDir = config.SCRAPER_DIR;
  const profileDir = path.join(scraperDir, 'profiles', slug);
  const keywordsPath = path.join(profileDir, 'keywords.txt');
  const leadsPath = path.join(profileDir, 'leads.csv');

  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(keywordsPath, cleanKeywords.join('\n') + '\n', 'utf8');

  // Emails already in this profile before the run — so we can report only what's
  // genuinely new, even though importLeadRows() is idempotent.
  const before = new Set((await readLeads(leadsPath)).map((r) => r.email));

  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cookieSubDir = path.join(config.YTDLP_COOKIES_DIR || 'cookies', id);
  const cookieDir = path.join(scraperDir, cookieSubDir);

  // Rebuild the on-disk cookie pool from Postgres (the durable source of
  // truth) right before spawning into a per-run isolated directory.
  await materializeCookiePool(scraperDir, userId, cookieSubDir);

  const job: ScrapeJob = {
    id,
    userId,
    niche,
    keywords: cleanKeywords,
    source: 'manual',
    status: 'running',
    startedAt: new Date().toISOString(),
    log: [],
  };
  jobs.set(id, job);

  reserveSlot();
  const released = { done: false };

  const child = spawn(config.PYTHON_BIN, ['-u', 'main.py', '--niche', niche], {
    cwd: scraperDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', YTDLP_COOKIES_DIR: cookieSubDir },
  });
  procs.set(id, child);
  appendLog(job, `▶ scrape started for ${cleanKeywords.length} keyword(s)`);

  child.stdout?.on('data', (d) => appendLog(job, d.toString()));
  child.stderr?.on('data', (d) => appendLog(job, d.toString()));

  child.on('error', (err) => {
    releaseSlot(released);
    logger.error({ err, jobId: id }, 'scraper spawn failed');
    job.status = 'failed';
    job.error = `Failed to launch scraper: ${err.message}`;
    job.finishedAt = new Date().toISOString();
    procs.delete(id);
    fs.rm(cookieDir, { recursive: true, force: true }).catch(() => {});
  });

  child.on('close', async (code, signal) => {
    releaseSlot(released);
    procs.delete(id);
    try {
      if (job.status === 'cancelled') {
        appendLog(job, '■ cancelled');
        job.finishedAt = new Date().toISOString();
        return;
      }
      await finishJob(job, leadsPath, before, code, signal, importToCrm);
    } finally {
      await fs.rm(cookieDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  return job;
}

/** Read a profile's keywords.txt (one query per line, '#' comments ignored). */
async function readKeywordsFile(keywordsPath: string): Promise<string[]> {
  try {
    const text = await fs.readFile(keywordsPath, 'utf8');
    return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Start an automatic scrape for `userId`: no keywords supplied by the caller —
 * orchestrator.py generates `keywordCount` fresh ones via Gemini (excluding
 * every keyword ever used for this tenant, see used_keywords.txt) and writes
 * them itself before running main.py. Used by autoScheduler.ts's ticker, not
 * the HTTP routes, so unlike startJob() this resolves only once the run has
 * fully finished (the caller has no HTTP client polling it).
 */
export async function startAutoJob(userId: string, keywordCount: number): Promise<ScrapeJob> {
  if (!config.SCRAPER_DIR) {
    throw Object.assign(new Error('Scraper is not configured on this server'), { code: 'SCRAPER_DISABLED', status: 503 });
  }
  if (activeJobFor(userId)) {
    throw Object.assign(new Error('A scrape is already running for your account'), { code: 'CONFLICT', status: 409 });
  }
  assertCapacity();

  const niche = `crm-${userId}`;
  const slug = slugify(niche);
  const scraperDir = config.SCRAPER_DIR;
  const profileDir = path.join(scraperDir, 'profiles', slug);
  const keywordsPath = path.join(profileDir, 'keywords.txt');
  const leadsPath = path.join(profileDir, 'leads.csv');

  await fs.mkdir(profileDir, { recursive: true });
  const before = new Set((await readLeads(leadsPath)).map((r) => r.email));

  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cookieSubDir = path.join(config.YTDLP_COOKIES_DIR || 'cookies', id);
  const cookieDir = path.join(scraperDir, cookieSubDir);

  // Rebuild the on-disk cookie pool from Postgres before spawning into a per-run directory.
  await materializeCookiePool(scraperDir, userId, cookieSubDir);

  const job: ScrapeJob = {
    id,
    userId,
    niche,
    keywords: [], // populated after Gemini writes keywords.txt (see below)
    source: 'auto',
    status: 'running',
    startedAt: new Date().toISOString(),
    log: [],
  };
  jobs.set(id, job);

  reserveSlot();
  const released = { done: false };

  const child = spawn(
    config.PYTHON_BIN,
    ['-u', 'orchestrator.py', '--niche', niche, '--keywords', String(keywordCount), '--once'],
    { cwd: scraperDir, env: { ...process.env, PYTHONIOENCODING: 'utf-8', YTDLP_COOKIES_DIR: cookieSubDir } },
  );
  procs.set(id, child);
  appendLog(job, `▶ auto-scrape started (${keywordCount} fresh keyword(s) via Gemini)`);

  child.stdout?.on('data', (d) => appendLog(job, d.toString()));
  child.stderr?.on('data', (d) => appendLog(job, d.toString()));

  return new Promise((resolve) => {
    child.on('error', (err) => {
      releaseSlot(released);
      logger.error({ err, jobId: id }, 'auto-scraper spawn failed');
      job.status = 'failed';
      job.error = `Failed to launch scraper: ${err.message}`;
      job.finishedAt = new Date().toISOString();
      procs.delete(id);
      fs.rm(cookieDir, { recursive: true, force: true }).catch(() => {});
      resolve(job);
    });

    child.on('close', async (code, signal) => {
      releaseSlot(released);
      procs.delete(id);
      try {
        if (job.status === 'cancelled') {
          appendLog(job, '■ cancelled');
          job.finishedAt = new Date().toISOString();
          resolve(job);
          return;
        }
        // orchestrator.py generates + writes keywords.txt itself before running
        // main.py — read it back now purely for job-history display.
        job.keywords = await readKeywordsFile(keywordsPath);
        // Auto-scheduled runs are hands-off by design (no user present to review),
        // so they always import — the CSV-only toggle only applies to manual runs.
        await finishJob(job, leadsPath, before, code, signal, true);
        resolve(job);
      } finally {
        await fs.rm(cookieDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
}

/** Cancel a tenant's running job, if any. Returns true if one was killed. */
export function cancelJob(userId: string, id: string): boolean {
  const job = getJob(userId, id);
  if (!job || job.status !== 'running') return false;
  job.status = 'cancelled';
  const child = procs.get(id);
  if (child) child.kill('SIGTERM');
  return true;
}
