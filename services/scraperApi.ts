import { apiGet, apiPost, apiPatch, apiDelete, apiUpload, apiDownload } from './apiClient';

/**
 * Frontend data layer for the in-app YouTube scraper, backed by the
 * tenant-scoped /api/scraper routes (server/src/scraper/routes.ts). Every call
 * carries the JWT via apiClient, so jobs are automatically scoped to the
 * logged-in tenant.
 */

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors: Array<{ email: string; message: string }>;
}

export type JobSource = 'manual' | 'auto';

export interface ScrapeJob {
  id: string;
  status: JobStatus;
  keywords: string[];
  source?: JobSource;
  startedAt: string;
  finishedAt?: string;
  log: string[];
  summary?: ImportSummary;
  error?: string;
  /** Whether this run's leads were written into the CRM (false = CSV-only). */
  imported?: boolean;
  /** True once /jobs/:id/download has something to serve. */
  downloadable?: boolean;
}

export interface AutoScheduleSummary {
  created: number;
  updated: number;
  skipped: number;
  error?: string;
}

export interface AutoSchedule {
  enabled: boolean;
  runsPerDay: 3 | 5;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSummary: AutoScheduleSummary | null;
}

export const getScraperStatus = () =>
  apiGet<{ configured: boolean; activeJobId: string | null }>('/api/scraper');

export const startScrape = async (keywords: string[], importToCrm = true): Promise<ScrapeJob> => {
  const data = await apiPost<{ job: ScrapeJob }>('/api/scraper/jobs', { keywords, importToCrm });
  return data.job;
};

export const listScrapeJobs = async (): Promise<ScrapeJob[]> => {
  const data = await apiGet<{ jobs: ScrapeJob[] }>('/api/scraper/jobs');
  return data.jobs ?? [];
};

export const getScrapeJob = async (id: string): Promise<ScrapeJob> => {
  const data = await apiGet<{ job: ScrapeJob }>(`/api/scraper/jobs/${id}`);
  return data.job;
};

export const cancelScrapeJob = (id: string) =>
  apiPost<{ ok: boolean }>(`/api/scraper/jobs/${id}/cancel`);

export const downloadScrapeCsv = (id: string) =>
  apiDownload(`/api/scraper/jobs/${id}/download`, `scrape-${id}.csv`);

export const getAutoSchedule = () => apiGet<AutoSchedule>('/api/scraper/auto');

export const updateAutoSchedule = (patch: { enabled?: boolean; runsPerDay?: 3 | 5 }) =>
  apiPatch<AutoSchedule>('/api/scraper/auto', patch);

// ── Qualification criteria ──────────────────────────────────────────────────
// What counts as a lead — mirrors scraper/criteria.py's Criteria dataclass
// (server/src/scraper/routes.ts clamps and persists these to ScraperSettings,
// then service.ts writes them to the profile's settings.json before every
// scrape spawn).

export interface ScraperSettings {
  minSubs: number;
  maxSubs: number;
  recentDays: number;
  minAvgViews: number;
  minLongformRatio: number;
  longformMinSecs: number;
  searchResults: number;
  uploadsSample: number;
  faceCheckSample: number;
  /** Days a temporarily-rejected channel is parked before it's re-crawled
   * instead of staying permanently blacklisted. */
  recheckDays: number;
  /** Empty = use the scraper's built-in defaults. */
  strongSignals: string[];
  weakSignals: string[];
  keywordsPerAutoRun: number;
}

export interface UpdateScraperSettingsResult {
  settings: ScraperSettings;
  /** Which fields loosened a blacklist-gating threshold in this save — an
   * empty array means nothing here would release any blacklisted channel. */
  loosened: string[];
  /** How many currently-blacklisted channels this change would release,
   * computed against the fields in `loosened` (dry run — nothing is
   * released until releaseBlacklisted() is called). */
  releasable: number;
}

export interface ReleaseResult {
  released: number;
  byReason: Record<string, number>;
  backup: string | null;
}

export const getScraperSettings = () => apiGet<ScraperSettings>('/api/scraper/settings');

export const updateScraperSettings = (patch: Partial<ScraperSettings>) =>
  apiPatch<UpdateScraperSettingsResult>('/api/scraper/settings', patch);

/** Actually release the channels the last update's dry run found —
 * `includeSignalGate` also releases channels blacklisted for having no
 * qualification signals (only verifiable in aggregate, not per channel —
 * see release_blacklist.py). */
export const releaseBlacklisted = (includeSignalGate: boolean) =>
  apiPost<ReleaseResult>('/api/scraper/settings/release', { includeSignalGate });

// ── Cookie rotation pool ──────────────────────────────────────────────────────
// The scraper rotates across these Netscape cookie files (one per logged-in
// YouTube account) so no single account gets rate-limited under long runs.

export interface CookieFile {
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

export const listCookieFiles = async (): Promise<CookieFile[]> => {
  const data = await apiGet<{ files: CookieFile[] }>('/api/scraper/cookies');
  return data.files ?? [];
};

export const uploadCookieFiles = async (files: File[]): Promise<CookieFile[]> => {
  const data = await apiUpload<{ files: CookieFile[] }>('/api/scraper/cookies', files);
  return data.files ?? [];
};

export const deleteCookieFile = (name: string) =>
  apiDelete<{ ok: boolean }>(`/api/scraper/cookies/${encodeURIComponent(name)}`);
