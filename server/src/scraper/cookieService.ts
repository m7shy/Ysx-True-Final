// FILE: server/src/scraper/cookieService.ts

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { prisma } from '../db/prisma.js';
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../creds/crypto.js';
import { config } from '../config.js';

/**
 * Postgres-backed management of the YouTube cookie-file pool that the Python
 * scraper rotates across (scraper/cookie_manager.py). The DB (CookieFile
 * model) is the source of truth — encrypted at rest with the same
 * AES-256-GCM helper used for mailbox OAuth tokens — so the pool survives Fly
 * redeploys and machine restarts, unlike the app's ephemeral rootfs.
 *
 * The Python scraper only knows how to read *files*, so materializeToDisk()
 * writes the current DB rows out to SCRAPER_DIR/cookies/*.txt as a disk
 * scratch cache; service.ts calls it right before every scraper spawn. That
 * directory should be treated as disposable — it is rebuilt from the DB on
 * every run and is not itself durable storage.
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

  // `name` is a global-unique column (legacy, pre-tenant-scoping schema): if
  // another tenant already owns this filename, don't silently steal/overwrite
  // it — that would be the same cross-tenant hole this scoping is fixing.
  const existing = await prisma.cookieFile.findUnique({ where: { name }, select: { userId: true } });
  if (existing && existing.userId && existing.userId !== userId) {
    throw Object.assign(new Error('A cookie file with this name already exists for another account'), {
      status: 409,
      code: 'CONFLICT',
    });
  }

  const row = await prisma.cookieFile.upsert({
    where: { name },
    update: { content, sizeBytes: buffer.length, userId },
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
 * Rebuild the specified on-disk directory (e.g. per-run SCRAPER_DIR/cookies/<runId>)
 * from the DB pool. Called right before every scraper spawn (service.ts) so the
 * Python child sees the current pool for its tenant regardless of what survived
 * on disk since the last run.
 *
 * Removes any zero-rows early return so an empty DB pool yields an empty directory,
 * preventing a tenant with zero cookie files from inheriting files written by another tenant.
 */
export async function materializeCookiePool(
  scraperDir: string,
  userId: string,
  subDir?: string,
): Promise<string> {
  const dir = subDir
    ? (path.isAbsolute(subDir) ? subDir : path.join(scraperDir, subDir))
    : path.join(scraperDir, config.YTDLP_COOKIES_DIR);

  const rows = await prisma.cookieFile.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    select: { name: true, content: true },
  });

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

  return dir;
}
