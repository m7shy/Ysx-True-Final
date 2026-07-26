// FILE: server/src/scraper/cookieService.ts

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { prisma } from '../db/prisma.js';
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../creds/crypto.js';

/**
 * Postgres-backed management of the YouTube cookie-file pool that the Python
 * scraper rotates across (scraper/cookie_manager.py). The DB (CookieFile
 * model) is the source of truth — encrypted at rest with the same
 * AES-256-GCM helper used for mailbox OAuth tokens — so the pool survives Fly
 * redeploys and machine restarts, unlike the app's ephemeral rootfs.
 *
 * The Python scraper only knows how to read *files*, so materializeCookiePool()
 * writes the current DB rows out to the tenant's own profile dir
 * (profiles/<slug>/cookies/*.txt, passed in by the caller) as a disk scratch
 * cache; service.ts calls it right before every scraper spawn and points the
 * child's YTDLP_COOKIES_DIR env var at that same per-tenant directory. That
 * directory should be treated as disposable — it is rebuilt from the DB on
 * every run and is not itself durable storage.
 *
 * Per-tenant isolation matters here specifically because scrapes for
 * different tenants can run concurrently (service.ts allows several children
 * at once, across tenants). A single shared cookies dir would let one
 * tenant's materialize-and-wipe race another tenant's still-starting Python
 * process into loading the wrong account's session cookies — this directory
 * must never be shared across tenants.
 *
 * Per-tenant pool: CookieFile.userId scopes every row to the tenant that
 * uploaded it. Legacy rows predating this scoping have userId=null and
 * remain visible to every tenant (matches the original single-tenant
 * behavior for cookies uploaded before multi-tenant scoping existed) — but
 * every new upload is scoped, and delete/list are bounded to "mine or
 * legacy-null", closing the cross-tenant read/overwrite/delete hole where
 * any authenticated tenant could manage another tenant's YouTube session
 * cookies.
 *
 * The `.adopted` marker the Python side drops (after copying a legacy
 * cookies.txt into the pool) lives only on disk and is intentionally never
 * synced to/from the DB — it just prevents that one process instance from
 * re-adopting the legacy file after the (DB-backed) pool has been emptied
 * through the UI.
 */

export interface CookieFileInfo {
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

export function isConfigured(): boolean {
  return hasEncryptionKey();
}

/**
 * Reduce an uploaded filename to a safe basename inside the pool dir:
 *   • strip any directory components (path-traversal guard);
 *   • enforce a .txt extension (Netscape cookie jars only);
 *   • allow only a conservative charset, collapsing the rest to '_'.
 * Throws on anything that can't be made safe (e.g. empty, not .txt).
 */
export function sanitizeCookieName(raw: string): string {
  const base = path.basename(raw || '').trim();
  if (!base || base.startsWith('.')) {
    throw Object.assign(new Error('Invalid cookie filename'), { status: 400, code: 'VALIDATION' });
  }
  if (path.extname(base).toLowerCase() !== '.txt') {
    throw Object.assign(new Error('Cookie files must be .txt (Netscape format)'), {
      status: 400,
      code: 'VALIDATION',
    });
  }
  const stem = base.slice(0, -4).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+/, '');
  if (!stem) {
    throw Object.assign(new Error('Invalid cookie filename'), { status: 400, code: 'VALIDATION' });
  }
  return `${stem}.txt`;
}

function requireEncryptionKey(): void {
  if (!hasEncryptionKey()) {
    throw Object.assign(
      new Error('Cookie storage is not configured (MAILBOX_ENCRYPTION_KEY unset)'),
      { status: 503, code: 'NOT_CONFIGURED' },
    );
  }
}

/** A tenant sees their own cookie files plus legacy (pre-scoping) unowned rows. */
export async function listCookieFiles(userId: string): Promise<CookieFileInfo[]> {
  const rows = await prisma.cookieFile.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    select: { name: true, sizeBytes: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ name: r.name, sizeBytes: r.sizeBytes, uploadedAt: r.updatedAt.toISOString() }));
}

export async function saveCookieFile(userId: string, originalName: string, buffer: Buffer): Promise<CookieFileInfo> {
  requireEncryptionKey();
  if (!buffer || buffer.length === 0) {
    throw Object.assign(new Error('Cookie file is empty'), { status: 400, code: 'VALIDATION' });
  }
  const name = sanitizeCookieName(originalName);
  const content = encryptSecret(buffer.toString('utf8'));

  // Filenames are now scoped per tenant (@@unique([userId, name])), so each
  // tenant has its own namespace and the cross-tenant conflict check that used
  // to live here is gone: one tenant uploading "cookies.txt" no longer blocks
  // that name for everyone else, which is what the old global @unique did.
  const row = await prisma.cookieFile.upsert({
    where: { userId_name: { userId, name } },
    update: { content, sizeBytes: buffer.length },
    create: { name, content, sizeBytes: buffer.length, userId },
  });
  return { name: row.name, sizeBytes: row.sizeBytes, uploadedAt: row.updatedAt.toISOString() };
}

export async function deleteCookieFile(userId: string, rawName: string): Promise<void> {
  const name = sanitizeCookieName(rawName);
  const result = await prisma.cookieFile.deleteMany({
    where: { name, OR: [{ userId }, { userId: null }] },
  });
  if (result.count === 0) {
    throw Object.assign(new Error('Cookie file not found'), { status: 404, code: 'NOT_FOUND' });
  }
}

/**
 * Rebuild `cookiesDir`/*.txt from the DB pool. Called right before every
 * scraper spawn (service.ts) with that tenant's own profile cookies dir, so
 * the Python child sees only its own tenant's current pool regardless of
 * what survived on disk since the last run — and regardless of any other
 * tenant's scrape running concurrently. No-op (leaves the dir untouched)
 * when the pool is empty — in that case the Python side's own legacy-cookie
 * auto-adopt logic (cookie_manager.py) still gets a chance to run.
 */
export async function materializeCookiePool(cookiesDir: string, userId: string): Promise<void> {
  const rows = await prisma.cookieFile.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    select: { name: true, content: true },
  });
  if (rows.length === 0) return;

  const dir = cookiesDir;
  await fs.mkdir(dir, { recursive: true });

  // Clear stale *.txt files from a previous materialization (e.g. one that
  // was since deleted from the DB) without touching the .adopted marker.
  const existing = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    existing
      .filter((n) => n.toLowerCase().endsWith('.txt'))
      .map((n) => fs.unlink(path.join(dir, n)).catch(() => {})),
  );

  await Promise.all(
    rows.map((r) => fs.writeFile(path.join(dir, r.name), decryptSecret(r.content), 'utf8')),
  );
}
