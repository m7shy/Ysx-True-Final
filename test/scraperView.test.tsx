// FILE: test/scraperView.test.tsx
//
// The Scraper screen must survive a status it has never heard of.
//
// When 'cancelling' was added to the server's JobStatus and not to the client's,
// `STATUS_META[status]` returned undefined, the next line read `.Icon` off it,
// and the whole view white-screened the moment Stop was pressed. `tsc` stayed
// green throughout — the map is a Record over the CLIENT union, so dropping a
// server status from that union merely makes the map smaller, never wrong.
//
// That was the third client/server shape mismatch in two days and the only one
// with no regression net. These tests are the net: they are deliberately at the
// render level, because the failure is "renders nothing at all", and they treat
// an unknown status as a first-class case rather than an impossibility.
//
// scraperApi is mocked rather than apiClient: the defect lives entirely in how
// the component maps a status string to a label, so feeding the status in at the
// data-layer boundary exercises exactly that and nothing else.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getScraperStatus: vi.fn(),
  startScrape: vi.fn(),
  listScrapeJobs: vi.fn(),
  getScrapeJob: vi.fn(),
  cancelScrapeJob: vi.fn(),
  downloadScrapeCsv: vi.fn(),
  getAutoSchedule: vi.fn(),
  updateAutoSchedule: vi.fn(),
  listCookieFiles: vi.fn(),
  uploadCookieFiles: vi.fn(),
  deleteCookieFile: vi.fn(),
  getScraperSettings: vi.fn(),
  updateScraperSettings: vi.fn(),
  releaseBlacklisted: vi.fn(),
}));
vi.mock('../services/scraperApi', () => api);

vi.mock('../context/NotificationContext', () => ({
  useNotification: () => ({ showToast: vi.fn() }),
}));

import { ScraperView } from '../components/ScraperView';

const JOB = {
  id: 'job-1',
  status: 'running',
  keywords: ['faceless youtube automation'],
  startedAt: new Date().toISOString(),
  log: ['▶ scrape started'],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getScraperStatus.mockResolvedValue({ configured: true, activeJobId: 'job-1' });
  api.getScrapeJob.mockResolvedValue(JOB);
  api.listScrapeJobs.mockResolvedValue([]);
  // The optional panels are not what is under test; failing them is the
  // component's own documented non-fatal path.
  api.getAutoSchedule.mockRejectedValue(new Error('n/a'));
  api.listCookieFiles.mockRejectedValue(new Error('n/a'));
  api.getScraperSettings.mockRejectedValue(new Error('n/a'));
});

describe('ScraperView — status rendering', () => {
  it('renders a cancelling job as "Stopping…" instead of white-screening', async () => {
    api.getScrapeJob.mockResolvedValue({ ...JOB, status: 'cancelling' });

    render(<ScraperView />);

    await waitFor(() => expect(screen.getByText('Stopping…')).toBeInTheDocument());
    // The view is still there — the crash took the whole screen with it.
    expect(screen.getByText('YouTube Scraper')).toBeInTheDocument();
  });

  it('degrades a status the client has never heard of to a label', async () => {
    // The point is not this particular string; it is that the NEXT status the
    // server adds cannot blank the page before anyone updates the client union.
    api.getScrapeJob.mockResolvedValue({ ...JOB, status: 'zombified' });

    render(<ScraperView />);

    await waitFor(() => expect(screen.getByText('zombified')).toBeInTheDocument());
    expect(screen.getByText('YouTube Scraper')).toBeInTheDocument();
  });

  it('survives an unknown status in the run history too', async () => {
    // The history row shows only the icon, so the assertion is that the row
    // renders at all — reading `.Icon` off an undefined meta is the crash.
    api.getScraperStatus.mockResolvedValue({ configured: true, activeJobId: null });
    api.listScrapeJobs.mockResolvedValue([
      { ...JOB, id: 'job-old', status: 'zombified', keywords: ['an old run'] },
    ]);

    render(<ScraperView />);

    await waitFor(() => expect(screen.getByText('an old run')).toBeInTheDocument());
    expect(screen.getByText('Past runs')).toBeInTheDocument();
  });

  it('keeps the run controls in the running state while cancelling', async () => {
    // 'cancelling' is not terminal: the server still holds this tenant's slot,
    // so offering Start again can only produce a 409.
    api.getScrapeJob.mockResolvedValue({ ...JOB, status: 'cancelling' });

    render(<ScraperView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /start scrape/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scrape keywords')).toBeDisabled();
  });

  it('offers Start again once the job has genuinely finished', async () => {
    api.getScrapeJob.mockResolvedValue({ ...JOB, status: 'succeeded' });

    render(<ScraperView />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start scrape/i })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Scrape keywords')).not.toBeDisabled();
  });
});
