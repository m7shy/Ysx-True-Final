import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cookieFile: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));

import {
  sanitizeCookieName,
  saveCookieFile,
  listCookieFiles,
  deleteCookieFile,
  materializeCookiePool,
} from '../scraper/cookieService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeCookieName', () => {
  it('accepts a plain .txt filename', () => {
    expect(sanitizeCookieName('account1.txt')).toBe('account1.txt');
  });

  it('strips path components (traversal guard)', () => {
    expect(sanitizeCookieName('../../etc/passwd.txt')).toBe('passwd.txt');
  });

  it('rejects non-.txt files', () => {
    expect(() => sanitizeCookieName('cookies.json')).toThrow(/\.txt/);
  });

  it('rejects empty/dotfile names', () => {
    expect(() => sanitizeCookieName('.adopted')).toThrow();
    expect(() => sanitizeCookieName('')).toThrow();
  });
});

describe('saveCookieFile / listCookieFiles / deleteCookieFile', () => {
  it('encrypts content before writing and round-trips size/name through the DB row', async () => {
    const now = new Date();
    prismaMock.cookieFile.findUnique.mockResolvedValue(null);
    prismaMock.cookieFile.upsert.mockImplementation(async ({ create }: any) => ({
      ...create,
      updatedAt: now,
    }));

    const buffer = Buffer.from('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tX\tY\n', 'utf8');
    const info = await saveCookieFile('u1', 'my account.txt', buffer);

    expect(info.name).toBe('my_account.txt');
    expect(info.sizeBytes).toBe(buffer.length);

    // Ciphertext, not plaintext, must have been persisted.
    const call = prismaMock.cookieFile.upsert.mock.calls[0][0];
    expect(call.create.content).not.toContain('youtube.com');
    expect(call.create.content.startsWith('v1:')).toBe(true);
    expect(call.create.userId).toBe('u1');
  });

  it('rejects overwriting a filename owned by a different tenant', async () => {
    prismaMock.cookieFile.findUnique.mockResolvedValue({ userId: 'u2' });
    await expect(saveCookieFile('u1', 'shared.txt', Buffer.from('x'))).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(prismaMock.cookieFile.upsert).not.toHaveBeenCalled();
  });

  it('lists a tenant\'s own files plus legacy unowned rows, mapping updatedAt to uploadedAt', async () => {
    const now = new Date();
    prismaMock.cookieFile.findMany.mockResolvedValue([
      { name: 'a.txt', sizeBytes: 10, updatedAt: now },
    ]);
    const files = await listCookieFiles('u1');
    expect(files).toEqual([{ name: 'a.txt', sizeBytes: 10, uploadedAt: now.toISOString() }]);
    expect(prismaMock.cookieFile.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ userId: 'u1' }, { userId: null }],
    });
  });

  it('maps a not-found/not-owned delete to a 404', async () => {
    prismaMock.cookieFile.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteCookieFile('u1', 'ghost.txt')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('deletes only within the tenant-or-legacy scope', async () => {
    prismaMock.cookieFile.deleteMany.mockResolvedValue({ count: 1 });
    await deleteCookieFile('u1', 'mine.txt');
    expect(prismaMock.cookieFile.deleteMany).toHaveBeenCalledWith({
      where: { name: 'mine.txt', OR: [{ userId: 'u1' }, { userId: null }] },
    });
  });
});

describe('materializeCookiePool', () => {
  it('writes decrypted DB rows to disk and clears stale .txt files without touching .adopted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cookie-materialize-'));
    const cookiesDir = path.join(dir, 'cookies');
    await fs.mkdir(cookiesDir, { recursive: true });
    await fs.writeFile(path.join(cookiesDir, 'stale.txt'), 'stale content', 'utf8');
    await fs.writeFile(path.join(cookiesDir, '.adopted'), '', 'utf8');

    // Round-trip through the real saveCookieFile encryption so the stored
    // ciphertext is genuine, then feed it back through findMany as materialize sees it.
    prismaMock.cookieFile.findUnique.mockResolvedValue(null);
    prismaMock.cookieFile.upsert.mockImplementation(async ({ create }: any) => ({ ...create, updatedAt: new Date() }));
    const saved = await saveCookieFile('u1', 'fresh.txt', Buffer.from('fresh-cookie-content', 'utf8'));
    const storedContent = prismaMock.cookieFile.upsert.mock.calls[0][0].create.content;
    prismaMock.cookieFile.findMany.mockResolvedValue([{ name: saved.name, content: storedContent }]);

    await materializeCookiePool(dir, 'u1');

    const remaining = await fs.readdir(cookiesDir);
    expect(remaining.sort()).toEqual(['.adopted', 'fresh.txt']);
    expect(await fs.readFile(path.join(cookiesDir, 'fresh.txt'), 'utf8')).toBe('fresh-cookie-content');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates an empty directory when the DB pool is empty (clearing stale files without inheriting)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cookie-materialize-empty-'));
    prismaMock.cookieFile.findMany.mockResolvedValue([]);
    await materializeCookiePool(dir, 'u1');
    const files = await fs.readdir(path.join(dir, 'cookies'));
    expect(files).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('ensures materializeCookiePool for a tenant with zero cookie rows does not expose another tenant files', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cookie-tenant-isolation-'));
    
    // Simulate tenant u2 having materialized cookies in u2's per-run directory
    const dirU2 = path.join(baseDir, 'cookies', 'job_u2');
    await fs.mkdir(dirU2, { recursive: true });
    await fs.writeFile(path.join(dirU2, 'u2_secret.txt'), 'tenant-2-secret-session', 'utf8');

    // Tenant u1 has 0 cookie rows in DB
    prismaMock.cookieFile.findMany.mockResolvedValue([]);

    // Materialize tenant u1 into its own run directory job_u1
    const subDirU1 = path.join('cookies', 'job_u1');
    const materializedPathU1 = await materializeCookiePool(baseDir, 'u1', subDirU1);

    expect(materializedPathU1).toBe(path.join(baseDir, subDirU1));
    const filesU1 = await fs.readdir(materializedPathU1);

    // Tenant u1's materialized cookie pool must be empty and must not contain u2's files
    expect(filesU1).toEqual([]);
    expect(filesU1).not.toContain('u2_secret.txt');

    await fs.rm(baseDir, { recursive: true, force: true });
  });
});
