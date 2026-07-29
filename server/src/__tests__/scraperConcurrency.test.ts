// FILE: server/src/__tests__/scraperConcurrency.test.ts
//
// One scrape per tenant, enforced against concurrent starts.
//
// The guard existed but was check-then-act: `activeJobFor()` and
// `assertCapacity()` ran, and then FIVE awaits followed before the job was
// registered — creating the profile directory, writing keywords.txt, reading
// leads.csv, and two Postgres round-trips for the cookie pool and settings.
// Node does not interleave synchronous code but interleaves at every await, so
// two starts arriving together (a double-clicked Start, or a manual run landing
// on top of the auto-scheduler) both passed the check and both spawned.
//
// Two scrapers then fought over one profile's keywords.txt, leads.csv and SQLite
// file. The per-tenant profile layout is no defence here: both runs belong to
// the SAME tenant and therefore the same directory.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { spawned, fsCalls } = vi.hoisted(() => ({
  spawned: [] as any[],
  fsCalls: { mkdir: 0, writeFile: 0 },
}));

/** A child process that never exits, so the job stays 'running' for the assertions. */
function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const c = fakeChild();
    spawned.push(c);
    return c;
  }),
}));

vi.mock('node:fs', () => {
  // Every one of these is an await inside the preparation window, which is
  // exactly where the second caller used to slip through.
  const promises = {
    mkdir: vi.fn(async () => {
      fsCalls.mkdir++;
    }),
    writeFile: vi.fn(async () => {
      fsCalls.writeFile++;
    }),
    readFile: vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 0 })),
  };
  return { promises, default: { promises } };
});

vi.mock('../config.js', () => ({
  config: {
    SCRAPER_DIR: 'C:/fake/scraper',
    PYTHON_BIN: 'python',
    DATABASE_URL: 'postgres://fake',
    NODE_ENV: 'development',
  },
}));

vi.mock('../scraper/cookieService.js', () => ({
  materializeCookiePool: vi.fn(async () => {}),
}));

vi.mock('../db/tenantDb.js', () => ({
  tenantDb: () => ({
    scraperSettings: { findUnique: async () => null },
  }),
}));

vi.mock('../leads/importService.js', () => ({
  importLeadRows: vi.fn(async () => ({ created: 0, updated: 0, skipped: 0 })),
  scraperRowSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));

beforeEach(() => {
  spawned.length = 0;
  fsCalls.mkdir = 0;
  fsCalls.writeFile = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

describe('scraper — one run per tenant under concurrent starts', () => {
  it('spawns only ONE scraper when Start is double-clicked', async () => {
    const { startJob } = await import('../scraper/service.js');

    // Concurrent, not sequential. Sequential calls let the first finish and
    // register, which is not the race — the whole defect is the window between
    // the check and the registration.
    const results = await Promise.allSettled([
      startJob('tenant-1', ['keyword one']),
      startJob('tenant-1', ['keyword one']),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(spawned).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
  });

  it('spawns only ONE when a manual run collides with the auto-scheduler', async () => {
    const { startJob, startAutoJob } = await import('../scraper/service.js');

    // startAutoJob resolves only when the run finishes, so it is left pending
    // deliberately — the child never exits. The assertion is about how many
    // processes were spawned, not about completion.
    const auto = startAutoJob('tenant-2', 4);
    auto.catch(() => {}); // never settles here; the child is kept alive on purpose
    const manual = startJob('tenant-2', ['manual keyword']);

    const settled = await Promise.allSettled([manual]);
    // The auto run claimed synchronously but is still working through its own
    // preparation awaits, so let those drain before counting spawns.
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawned).toHaveLength(1);
    expect(settled[0].status).toBe('rejected');
  });

  it('lets a different tenant start concurrently — the cap is per tenant', async () => {
    const { startJob } = await import('../scraper/service.js');

    const results = await Promise.allSettled([
      startJob('tenant-a', ['k']),
      startJob('tenant-b', ['k']),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  it('evicts finished jobs instead of retaining every run forever', async () => {
    // `jobs` had no eviction at all — every scrape ever run stayed in memory for
    // the life of the process, each holding up to 800 log lines. At 3-5 auto-runs
    // per tenant per day that is a slow leak that would surface as unexplained
    // memory growth months later.
    process.env.SCRAPER_MAX_RETAINED_JOBS = '3';
    vi.resetModules();
    const { startJob, listJobs } = await import('../scraper/service.js');

    // Each run must finish before the next can start (one per tenant), so close
    // the child each time — which is also what makes the job evictable.
    for (let i = 0; i < 6; i++) {
      await startJob('tenant-evict', [`k${i}`]);
      const child = spawned[spawned.length - 1];
      child.emit('close', 0, null);
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(listJobs('tenant-evict').length).toBeLessThanOrEqual(3);
    delete process.env.SCRAPER_MAX_RETAINED_JOBS;
  });

  it('never evicts a RUNNING job, however far over the cap', async () => {
    // Dropping a running job would strand its child process and free a
    // concurrency slot that is still very much in use.
    process.env.SCRAPER_MAX_RETAINED_JOBS = '1';
    vi.resetModules();
    const { startJob, listJobs } = await import('../scraper/service.js');

    // Two finished runs for one tenant, then a live one for another.
    for (let i = 0; i < 2; i++) {
      await startJob('tenant-done', [`k${i}`]);
      spawned[spawned.length - 1].emit('close', 0, null);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const live = await startJob('tenant-live', ['k']);

    // A further claim triggers the sweep while `live` is still running.
    await startJob('tenant-other', ['k']).catch(() => {});

    expect(listJobs('tenant-live').some((j) => j.id === live.id && j.status === 'running')).toBe(true);
    delete process.env.SCRAPER_MAX_RETAINED_JOBS;
  });

  it('kills the whole process tree on cancel, not just the direct child', async () => {
    // child.kill() signals only the direct child. On Windows Node implements
    // that as TerminateProcess, which cannot be caught and does not touch
    // descendants — so main.py died while the yt-dlp processes it had spawned
    // kept running, holding the profile's files and SQLite database open. The
    // symptom on disk was 1-2 MB tracking.db-wal files beside 4 KB databases.
    const { startJob, cancelJob } = await import('../scraper/service.js');
    const cp: any = await import('node:child_process');

    const job = await startJob('tenant-cancel', ['k']);
    cp.spawn.mockClear();

    expect(cancelJob('tenant-cancel', job.id)).toBe(true);

    // On win32 that means taskkill /T (tree) /F; elsewhere a group signal.
    if (process.platform === 'win32') {
      const call = cp.spawn.mock.calls.find((c: any[]) => c[0] === 'taskkill');
      expect(call, 'expected a taskkill for the process tree').toBeTruthy();
      expect(call[1]).toContain('/T');
      expect(call[1]).toContain('/F');
    }
  });

  it('holds the tenant slot until the cancelled child actually exits', async () => {
    // Cancel used to set 'cancelled' the instant it signalled, and activeJobFor
    // only treated 'running' as occupied — so Stop immediately followed by Start
    // launched a second scraper into the same profile while the first was still
    // writing to it.
    const { startJob, cancelJob } = await import('../scraper/service.js');

    const job = await startJob('tenant-stopstart', ['k']);
    const child = spawned[spawned.length - 1];
    cancelJob('tenant-stopstart', job.id);

    // The child has been signalled but has NOT exited yet.
    await expect(startJob('tenant-stopstart', ['k'])).rejects.toMatchObject({ code: 'CONFLICT' });

    // Once it really exits the slot frees up and a new run is allowed.
    child.emit('close', null, 'SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    await expect(startJob('tenant-stopstart', ['k'])).resolves.toMatchObject({ status: 'running' });
  });

  it('reports success without re-signalling a job already being cancelled', async () => {
    const { startJob, cancelJob } = await import('../scraper/service.js');
    const cp: any = await import('node:child_process');

    const job = await startJob('tenant-twice', ['k']);
    cancelJob('tenant-twice', job.id);
    cp.spawn.mockClear();

    // The caller asked for it to stop and it is stopping — that is success, not
    // an error, but it must not fire a second kill.
    expect(cancelJob('tenant-twice', job.id)).toBe(true);
    expect(cp.spawn.mock.calls.filter((c: any[]) => c[0] === 'taskkill')).toHaveLength(0);
  });

  // taskkill EXITING non-zero (access denied, a pid it could not reach) is a
  // different failure from taskkill failing to spawn, and only the latter was
  // handled: the child stayed alive, nothing retried, and the job sat in
  // 'cancelling' holding the tenant's slot and a global slot until restart.
  const winOnly = process.platform === 'win32' ? it : it.skip;

  winOnly('falls back to a direct kill when taskkill exits non-zero', async () => {
    const { startJob, cancelJob } = await import('../scraper/service.js');

    const job = await startJob('tenant-killfail', ['k']);
    const child = spawned[spawned.length - 1];
    cancelJob('tenant-killfail', job.id);

    // The mocked spawn hands back a fake child for taskkill too.
    const killer = spawned[spawned.length - 1];
    expect(killer).not.toBe(child);
    expect(child.kill).not.toHaveBeenCalled();

    killer.emit('close', 1, null);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  winOnly('does not fall back when taskkill succeeds', async () => {
    const { startJob, cancelJob } = await import('../scraper/service.js');

    const job = await startJob('tenant-killok', ['k']);
    const child = spawned[spawned.length - 1];
    cancelJob('tenant-killok', job.id);
    spawned[spawned.length - 1].emit('close', 0, null);

    expect(child.kill).not.toHaveBeenCalled();
  });

  winOnly('re-signals a job still cancelling after the escalation deadline', async () => {
    vi.useFakeTimers();
    try {
      const { startJob, cancelJob, listJobs } = await import('../scraper/service.js');
      const cp: any = await import('node:child_process');

      const job = await startJob('tenant-wedged', ['k']);
      cancelJob('tenant-wedged', job.id);
      // The child never exits — the whole point: the close handler, which is the
      // only finalizer, never runs.
      cp.spawn.mockClear();

      await vi.advanceTimersByTimeAsync(60_000 + 1_000);

      expect(cp.spawn.mock.calls.filter((c: any[]) => c[0] === 'taskkill')).toHaveLength(1);

      // Escalating must NOT free the slot or force a terminal status: the child
      // may still be alive, and starting a second scraper into the same profile
      // is the bug 'cancelling' exists to prevent.
      expect(listJobs('tenant-wedged')[0].status).toBe('cancelling');
      await expect(startJob('tenant-wedged', ['k'])).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      vi.useRealTimers();
    }
  });

  winOnly('does not re-signal a job whose child has since exited', async () => {
    vi.useFakeTimers();
    try {
      const { startJob, cancelJob } = await import('../scraper/service.js');
      const cp: any = await import('node:child_process');

      const job = await startJob('tenant-clean-stop', ['k']);
      const child = spawned[spawned.length - 1];
      cancelJob('tenant-clean-stop', job.id);
      child.emit('close', null, 'SIGTERM');
      await Promise.resolve();
      cp.spawn.mockClear();

      await vi.advanceTimersByTimeAsync(60_000 + 1_000);
      expect(cp.spawn.mock.calls.filter((c: any[]) => c[0] === 'taskkill')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the claim when preparation fails, so the tenant is not locked out', async () => {
    const { startJob } = await import('../scraper/service.js');
    const fsMod: any = await import('node:fs');

    // A claim taken before preparation must be undone if preparation throws —
    // otherwise no child is ever spawned to release it, the tenant can never
    // scrape again until restart, and a global concurrency slot leaks for good.
    fsMod.promises.mkdir.mockRejectedValueOnce(new Error('EACCES'));
    await expect(startJob('tenant-3', ['k'])).rejects.toThrow('EACCES');
    expect(spawned).toHaveLength(0);

    // The retry must be allowed through rather than hitting a stale CONFLICT.
    await expect(startJob('tenant-3', ['k'])).resolves.toMatchObject({ status: 'running' });
    expect(spawned).toHaveLength(1);
  });
});
