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
