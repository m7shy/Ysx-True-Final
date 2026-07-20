// Daily Neon backup via pg_dump. Free-tier insurance: Neon free PITR history
// is short, and this survives Neon account loss entirely. Run from server/:
//   node scripts/backup-db.mjs
// Intended to be wired to a Windows Scheduled Task (see docs/RECOVERY.md).
// Requires pg_dump on PATH (PostgreSQL client tools) and DIRECT_URL in .env.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BACKUP_DIR = process.env.BACKUP_DIR || 'C:\\backups\\ysx';
const KEEP = 14;

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('DIRECT_URL/DATABASE_URL not set — run from server/ so dotenv finds .env');
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(BACKUP_DIR, `ysx-${stamp}.dump`);

let usedFallback = false;
try {
  // Custom format (-Fc): compressed, restorable table-by-table with pg_restore.
  execFileSync('pg_dump', ['--format=custom', `--file=${outFile}`, url], {
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 10 * 60_000,
  });
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`[backup] pg_dump FAILED: ${err.message}`);
    process.exit(1);
  }
  // pg_dump not installed (unelevated VM) — logical JSON fallback via pg over
  // TLS. Restore is manual per-table but the data is safe and off-Neon.
  console.warn('[backup] pg_dump not found — falling back to JSON table dump');
  usedFallback = true;
  await jsonDump(url, outFile.replace(/\.dump$/, '.json.gz'));
}

async function jsonDump(dbUrl, file) {
  const { PrismaClient } = await import('@prisma/client');
  const { gzipSync } = await import('node:zlib');
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const tables = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const out = {};
    for (const { tablename } of tables) {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${tablename}"`);
      out[tablename] = rows;
      console.log(`[backup] ${tablename}: ${rows.length} rows`);
    }
    // Dates → ISO strings, BigInt → strings; both survive a manual restore.
    const json = JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    fs.writeFileSync(file, gzipSync(json));
    console.log(`[backup] OK (JSON fallback): ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  } finally {
    await prisma.$disconnect();
  }
}

if (usedFallback) process.exit(0);

const size = fs.statSync(outFile).size;
if (size < 10_000) {
  console.error(`[backup] Dump suspiciously small (${size} bytes) — treat as FAILED`);
  process.exit(1);
}
console.log(`[backup] OK: ${outFile} (${Math.round(size / 1024)} KB)`);

// Prune to the newest KEEP dumps.
const dumps = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => /^ysx-\d{4}-\d{2}-\d{2}\.dump$/.test(f))
  .sort()
  .reverse();
for (const old of dumps.slice(KEEP)) {
  fs.unlinkSync(path.join(BACKUP_DIR, old));
  console.log(`[backup] Pruned ${old}`);
}
