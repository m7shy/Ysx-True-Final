import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Radar, Play, Square, Loader2, CheckCircle2, XCircle, Youtube, RefreshCw, Sparkles, Clock, KeyRound, Upload, Trash2, Download } from 'lucide-react';
import {
  ScrapeJob,
  AutoSchedule,
  CookieFile,
  getScraperStatus,
  startScrape,
  listScrapeJobs,
  getScrapeJob,
  cancelScrapeJob,
  downloadScrapeCsv,
  getAutoSchedule,
  updateAutoSchedule,
  listCookieFiles,
  uploadCookieFiles,
  deleteCookieFile,
} from '../services/scraperApi';
import { useNotification } from '../context/NotificationContext';
import { EASE, AnimatedHeading, Stagger, StaggerItem, MaskedReveal } from './motion/primitives';
import { Button, Textarea, Alert } from '../src/design/ui';

/**
 * "Scraper" view — lets a logged-in user launch the YouTube lead scraper and
 * watch it run. Keywords are typed here, the backend spawns the Python scraper
 * (server/src/scraper/service.ts), and the leads it finds land straight in this
 * tenant's Leads list. The active job is polled every few seconds for its live
 * log + result summary.
 */

const POLL_MS = 3000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_META: Record<ScrapeJob['status'], { label: string; className: string; Icon: any }> = {
  running:   { label: 'Running',   className: 'text-amber-400',   Icon: Loader2 },
  succeeded: { label: 'Done',      className: 'text-emerald-400', Icon: CheckCircle2 },
  failed:    { label: 'Failed',    className: 'text-red-400',     Icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'text-neutral-400', Icon: Square },
};

export const ScraperView: React.FC = () => {
  const { showToast } = useNotification();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keywords, setKeywords] = useState('');
  const [importToCrm, setImportToCrm] = useState(true);
  const [starting, setStarting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [current, setCurrent] = useState<ScrapeJob | null>(null);
  const [history, setHistory] = useState<ScrapeJob[]>([]);
  const [autoSchedule, setAutoSchedule] = useState<AutoSchedule | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [cookies, setCookies] = useState<CookieFile[]>([]);
  const [cookieBusy, setCookieBusy] = useState(false);

  const isMounted = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const cookieInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMounted.current = true;
    (async () => {
      try {
        const status = await getScraperStatus();
        if (!isMounted.current) return;
        setConfigured(status.configured);
        if (status.activeJobId) setActiveId(status.activeJobId);
      } catch {
        if (isMounted.current) setConfigured(false);
      }
      loadHistory();
      loadAutoSchedule();
      loadCookies();
    })();
    return () => { isMounted.current = false; };
  }, []);

  const loadAutoSchedule = async () => {
    try {
      const schedule = await getAutoSchedule();
      if (isMounted.current) setAutoSchedule(schedule);
    } catch { /* non-fatal */ }
  };

  const loadCookies = async () => {
    try {
      const files = await listCookieFiles();
      if (isMounted.current) setCookies(files);
    } catch { /* non-fatal */ }
  };

  const handleUploadCookies = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    setCookieBusy(true);
    try {
      const updated = await uploadCookieFiles(files);
      if (isMounted.current) setCookies(updated);
      showToast('SUCCESS', `Added ${files.length} cookie file(s) to the rotation.`);
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not upload cookie file(s).');
    } finally {
      if (isMounted.current) setCookieBusy(false);
      if (cookieInputRef.current) cookieInputRef.current.value = '';
    }
  };

  const handleDeleteCookie = async (name: string) => {
    if (cookieBusy) return;
    if (!window.confirm(`Remove "${name}" from the cookie rotation?`)) return;
    setCookieBusy(true);
    try {
      await deleteCookieFile(name);
      if (isMounted.current) setCookies((prev) => prev.filter((c) => c.name !== name));
      showToast('SUCCESS', `Removed ${name}.`);
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not remove the cookie file.');
    } finally {
      if (isMounted.current) setCookieBusy(false);
    }
  };

  const loadHistory = async () => {
    try {
      const jobs = await listScrapeJobs();
      if (isMounted.current) setHistory(jobs);
    } catch { /* non-fatal */ }
  };

  // Poll the active job while it runs.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const job = await getScrapeJob(activeId);
        if (cancelled || !isMounted.current) return;
        setCurrent(job);
        if (job.status !== 'running') {
          setActiveId(null);
          loadHistory();
          if (job.status === 'succeeded') {
            showToast('SUCCESS', `Scrape finished — ${job.summary?.created ?? 0} new lead(s) added.`);
          } else if (job.status === 'failed') {
            showToast('ERROR', job.error ?? 'Scrape failed.');
          }
        }
      } catch { /* keep polling */ }
    };

    tick();
    const h = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(h); };
  }, [activeId]);

  // Keep the log scrolled to the bottom as lines arrive.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [current?.log]);

  const handleStart = async () => {
    const list = keywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean);
    if (list.length === 0) {
      showToast('ERROR', 'Enter at least one keyword.');
      return;
    }
    setStarting(true);
    try {
      const job = await startScrape(list, importToCrm);
      setCurrent(job);
      setActiveId(job.id);
      showToast('SUCCESS', 'Scrape started.');
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not start the scrape.');
    } finally {
      if (isMounted.current) setStarting(false);
    }
  };

  const handleDownload = async (job: ScrapeJob) => {
    if (downloadingId) return;
    setDownloadingId(job.id);
    try {
      await downloadScrapeCsv(job.id);
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not download the CSV.');
    } finally {
      if (isMounted.current) setDownloadingId(null);
    }
  };

  const handleCancel = async () => {
    if (!current) return;
    try {
      await cancelScrapeJob(current.id);
      showToast('SUCCESS', 'Stopping the scrape…');
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not stop the scrape.');
    }
  };

  const handleToggleAuto = async () => {
    if (!autoSchedule || autoSaving) return;
    setAutoSaving(true);
    try {
      const updated = await updateAutoSchedule({ enabled: !autoSchedule.enabled });
      setAutoSchedule(updated);
      showToast('SUCCESS', updated.enabled ? 'Auto-scrape enabled.' : 'Auto-scrape disabled.');
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not update auto-scrape.');
    } finally {
      if (isMounted.current) setAutoSaving(false);
    }
  };

  const handleRunsPerDay = async (runsPerDay: 3 | 5) => {
    if (!autoSchedule || autoSaving || autoSchedule.runsPerDay === runsPerDay) return;
    setAutoSaving(true);
    try {
      const updated = await updateAutoSchedule({ runsPerDay });
      setAutoSchedule(updated);
      showToast('SUCCESS', `Auto-scrape set to ${runsPerDay}x/day.`);
    } catch (err: any) {
      showToast('ERROR', err?.message ?? 'Could not update auto-scrape.');
    } finally {
      if (isMounted.current) setAutoSaving(false);
    }
  };

  const isRunning = current?.status === 'running';

  if (configured === false) {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <MaskedReveal>
          <Alert variant="warning" title="Scraper not configured">
            The YouTube scraper isn’t wired up on this server yet. An admin needs to set
            <code className="mx-1 px-1.5 py-0.5 rounded bg-white/10 text-xs">SCRAPER_DIR</code>
            (and optionally <code className="mx-1 px-1.5 py-0.5 rounded bg-white/10 text-xs">PYTHON_BIN</code>)
            in the backend environment, then restart the server.
          </Alert>
        </MaskedReveal>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="mb-2">
        <AnimatedHeading as="h2" className="text-2xl font-semibold text-white mb-2 tracking-tight">
          YouTube Scraper
        </AnimatedHeading>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="text-neutral-400"
        >
          Launch keyword-driven scrapes, rotate cookies, and pull fresh leads straight into the CRM.
        </motion.p>
      </div>

      <Stagger className="space-y-6">
        {/* Launcher */}
        <StaggerItem className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <Youtube className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Find YouTube Leads</h2>
              <p className="text-sm text-neutral-400">
                {importToCrm
                  ? 'Enter niche keywords — one per line. New leads land in your Leads list automatically.'
                  : 'Enter niche keywords — one per line. Results stay off the CRM until you download and review the CSV.'}
              </p>
            </div>
          </div>

          <Textarea
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            disabled={isRunning || starting}
            rows={5}
            aria-label="Scrape keywords"
            placeholder={'faceless youtube automation\nfaceless channel course\nyoutube automation coaching'}
          />

          <label className="flex items-center gap-2 mt-3 text-sm text-neutral-300 select-none">
            <input
              type="checkbox"
              checked={importToCrm}
              onChange={(e) => setImportToCrm(e.target.checked)}
              disabled={isRunning || starting}
              className="rounded border-white/10 bg-white/[0.03] text-volt focus:ring-volt-text disabled:opacity-60"
            />
            Import results into the CRM automatically
            <span className="text-xs text-neutral-500">
              {importToCrm ? '' : '— unchecked: download the CSV instead, qualify offline, import later'}
            </span>
          </label>

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-neutral-500">
              {keywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean).length} keyword(s)
            </span>
            {isRunning ? (
              <Button
                variant="danger"
                size="sm"
                onClick={handleCancel}
                leftIcon={<Square className="w-4 h-4" />}
              >
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleStart}
                disabled={starting}
                loading={starting}
                leftIcon={<Play className="w-4 h-4" />}
              >
                {starting ? 'Starting…' : 'Start scrape'}
              </Button>
            )}
          </div>
        </StaggerItem>

        {/* Auto-scrape */}
        {autoSchedule && (
          <StaggerItem className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-volt/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-volt-text" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Auto-scrape</h2>
                  <p className="text-sm text-neutral-400">
                    Runs on its own with fresh Gemini-generated keywords, spread across the day.
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleAuto}
                disabled={autoSaving}
                role="switch"
                aria-checked={autoSchedule.enabled}
                aria-label="Toggle auto-scrape"
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60 ${
                  autoSchedule.enabled ? 'bg-volt shadow-[0_0_20px_rgb(2_1_255/0.55)]' : 'bg-white/10'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                    autoSchedule.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Runs per day:</span>
                {[3, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => handleRunsPerDay(n as 3 | 5)}
                    disabled={autoSaving || !autoSchedule.enabled}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-300 disabled:opacity-50 ${
                      autoSchedule.runsPerDay === n
                        ? 'bg-volt text-white shadow-[0_0_20px_rgb(2_1_255/0.55)]'
                        : 'bg-white/[0.03] border border-white/10 text-neutral-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {n}x
                  </button>
                ))}
              </div>

              {autoSchedule.enabled && autoSchedule.nextRunAt && (
                <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <Clock className="w-3.5 h-3.5" /> Next run: {new Date(autoSchedule.nextRunAt).toLocaleString()}
                </span>
              )}
            </div>

            {autoSchedule.lastRunAt && (
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
                <span>Last auto-run: {new Date(autoSchedule.lastRunAt).toLocaleString()}</span>
                {autoSchedule.lastRunSummary && (
                  autoSchedule.lastRunSummary.error ? (
                    <span className="text-red-400">{autoSchedule.lastRunSummary.error}</span>
                  ) : (
                    <span className="text-emerald-400">
                      +{autoSchedule.lastRunSummary.created} new · {autoSchedule.lastRunSummary.updated} refreshed
                    </span>
                  )
                )}
              </div>
            )}
          </StaggerItem>
        )}

        {/* Cookie rotation pool */}
        <StaggerItem className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">YouTube cookies</h2>
                <p className="text-sm text-neutral-400">
                  Upload a Netscape <code className="px-1 rounded bg-white/10 text-xs">cookies.txt</code> per
                  account. The scraper rotates across them so no single account gets rate-limited — more cookies, longer runs, more leads.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadCookies}
                className="p-1.5 text-neutral-400 hover:text-white rounded-full hover:bg-white/[0.05] transition-colors duration-300"
                title="Refresh"
                aria-label="Refresh cookie files"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <Button
                size="sm"
                onClick={() => cookieInputRef.current?.click()}
                disabled={cookieBusy}
                loading={cookieBusy}
                leftIcon={<Upload className="w-4 h-4" />}
              >
                Upload
              </Button>
              <input
                ref={cookieInputRef}
                type="file"
                accept=".txt"
                multiple
                onChange={(e) => handleUploadCookies(e.target.files)}
                className="hidden"
              />
            </div>
          </div>

          {cookies.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              No cookie files yet — the scraper runs unauthenticated and may hit YouTube’s bot check sooner.
            </p>
          ) : (
            <ul className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
              {cookies.map((c) => (
                <li key={c.name} className="px-4 py-2.5 flex items-center justify-between text-sm bg-white/[0.03]">
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                    <span className="truncate text-neutral-200">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <span className="text-xs text-neutral-500">{formatBytes(c.sizeBytes)}</span>
                    <span className="hidden sm:inline text-xs text-neutral-500">
                      {new Date(c.uploadedAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleDeleteCookie(c.name)}
                      disabled={cookieBusy}
                      className="text-neutral-500 hover:text-red-400 disabled:opacity-40 transition-colors duration-300"
                      title={`Remove ${c.name}`}
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </StaggerItem>

        {/* Live run */}
        {current && (
          <StaggerItem className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                {(() => {
                  const meta = STATUS_META[current.status];
                  const Icon = meta.Icon;
                  return (
                    <>
                      <Icon className={`w-4 h-4 ${meta.className} ${current.status === 'running' ? 'animate-spin' : ''}`} />
                      <span className={`text-sm font-medium ${meta.className}`}>{meta.label}</span>
                    </>
                  );
                })()}
                <span className="text-xs text-neutral-500">· {current.keywords.length} keyword(s)</span>
              </div>
              <div className="flex items-center gap-3">
                {current.summary && (
                  <span className="text-xs text-neutral-400">
                    {current.imported === false
                      ? `${current.summary.created} lead(s) scraped, not imported`
                      : `+${current.summary.created} new · ${current.summary.updated} refreshed · ${current.summary.skipped} skipped`}
                  </span>
                )}
                {current.downloadable && (
                  <button
                    onClick={() => handleDownload(current)}
                    disabled={downloadingId === current.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] disabled:opacity-60 text-xs font-medium text-neutral-300 transition-colors duration-300"
                  >
                    {downloadingId === current.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Download CSV
                  </button>
                )}
              </div>
            </div>
            <MaskedReveal className="bg-canvas/80">
              <div
                ref={logRef}
                className="text-neutral-300 font-mono text-xs leading-relaxed px-4 py-3 h-64 overflow-y-auto custom-scrollbar"
              >
                {current.log.length === 0 ? (
                  <span className="text-neutral-500">Waiting for output…</span>
                ) : (
                  current.log.map((line, i) => <div key={i} className="whitespace-pre-wrap break-all">{line}</div>)
                )}
              </div>
            </MaskedReveal>
          </StaggerItem>
        )}

        {/* History */}
        <StaggerItem className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <Radar className="w-4 h-4 text-volt-text" /> Past runs
            </h3>
            <button onClick={loadHistory} aria-label="Refresh past runs" className="p-1.5 text-neutral-400 hover:text-white rounded-full hover:bg-white/[0.05] transition-colors duration-300">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-neutral-500">No scrapes yet.</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {history.map((job) => {
                const meta = STATUS_META[job.status];
                const Icon = meta.Icon;
                return (
                  <li key={job.id} className="px-6 py-3 flex items-center justify-between text-sm hover:bg-white/[0.03] transition-colors duration-300">
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${meta.className}`} />
                      {job.source === 'auto' && (
                        <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-volt/15 border border-volt-text/25 text-volt-text text-[10px] font-medium uppercase tracking-wide">
                          <Sparkles className="w-3 h-3" /> Auto
                        </span>
                      )}
                      <span className="truncate text-neutral-200">
                        {job.keywords.length > 0 ? job.keywords.join(', ') : '(generating…)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-neutral-500">
                      {job.summary && (
                        <span className={job.imported === false ? 'text-neutral-500' : 'text-emerald-400'}>
                          {job.imported === false ? `${job.summary.created} scraped` : `+${job.summary.created}`}
                        </span>
                      )}
                      <span className="text-xs">{new Date(job.startedAt).toLocaleString()}</span>
                      {job.downloadable && (
                        <button
                          onClick={() => handleDownload(job)}
                          disabled={downloadingId === job.id}
                          title="Download CSV"
                          aria-label="Download CSV"
                          className="text-neutral-500 hover:text-volt-text disabled:opacity-40 transition-colors duration-300"
                        >
                          {downloadingId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </StaggerItem>
      </Stagger>
    </div>
  );
};
