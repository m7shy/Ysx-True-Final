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
