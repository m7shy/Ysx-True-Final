// Daily backup: Neon (via pg_dump) AND the scraper's local state. Free-tier insurance: Neon free PITR history
// is short, and this survives Neon account loss entirely. Run from server/:
//   node scripts/backup-db.mjs
// Intended to be wired to a Windows Scheduled Task (see docs/RECOVERY.md).
// Requires pg_dump on PATH (PostgreSQL client tools) and DIRECT_URL in .env.
//
// The scraper half matters as much as the database half. Postgres holds the
// leads; the scraper's "already evaluated this channel" state lives ONLY in
// SQLite on this VM (SCRAPER_DIR/profiles/<slug>/tracking.db) — roughly 10k
// processed-channel and 9.5k blacklist rows. Losing the VM without it means
// re-crawling every channel already rejected, burning crawl budget and YouTube
// quota for days. It was outside this script's scope until 2026-07-26.

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

function backupScraperState() {
  // ── Scraper local state ──────────────────────────────────────────────────────
  // tar is used rather than a zip lib to avoid adding a dependency; it ships with
  // Git for Windows. --force-local stops tar reading "C:" as a remote host.
  // The *.bak-* files are excluded: they are prior copies of tracking.db, so
  // including them roughly triples the archive for no recovery value.
  const scraperDir = process.env.SCRAPER_DIR
    ? path.resolve(process.cwd(), process.env.SCRAPER_DIR)
    : null;

  if (!scraperDir || !fs.existsSync(path.join(scraperDir, 'profiles'))) {
    console.warn('[backup] SCRAPER_DIR/profiles not found — skipping scraper state backup');
  } else {
    const scraperOut = path.join(BACKUP_DIR, `ysx-scraper-${stamp}.tar.gz`);
    try {
      // NO --force-local, and the archive path is passed relative to -C.
      //
      // This ran green for a day and produced nothing. `--force-local` is a GNU
      // tar flag, and GNU tar only exists here inside Git Bash
      // (C:\Program Files\Git\usr\bin, which is NOT on the machine PATH). Under
      // the Scheduled Task there is no shell, so `tar` resolves to
      // C:\Windows\system32\tar.exe — bsdtar — which answers
      // "Option --force-local is not supported" and exits non-zero. The catch
      // below swallowed it to a console.error that the task discards, so the
      // script reported success while the scraper archive was never written.
      // Verified by the output directory: the 03:00 run produced the DB dump
      // and no ysx-scraper-*.tar.gz, on every scheduled run.
      //
      // --force-local existed to stop GNU tar reading "C:\..." as host:path.
      // Splitting the path with -C removes the colon from the archive argument
      // entirely, so the flag is unnecessary for BOTH tars — this works under
      // bsdtar and GNU tar alike rather than trading one for the other.
      execFileSync(
        'tar',
        ['--exclude=*.bak-*', '-czf', path.basename(scraperOut), '-C', scraperDir, 'profiles'],
        { cwd: BACKUP_DIR, stdio: 'pipe' },
      );
      const ssize = fs.statSync(scraperOut).size;
      console.log(`[backup] Scraper state OK: ${scraperOut} (${Math.round(ssize / 1024)} KB)`);
    } catch (err) {
      // Never fail the whole backup because the scraper half failed — the
      // database dump above is the more critical artifact. But make the failure
      // impossible to miss: stderr goes to the task's log (see RECOVERY.md),
      // and the `backups` deep-health check independently alerts when today's
      // scraper archive is absent, so a silent skip cannot recur.
      console.error(`[backup] Scraper state FAILED: ${err.message}`);
      console.error(`[backup] stderr: ${err.stderr?.toString?.() ?? '(none)'}`);
    }

    for (const old of fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^ysx-scraper-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
      .sort()
      .reverse()
      .slice(KEEP)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      console.log(`[backup] Pruned ${old}`);
    }
  }
}

let usedFallback = false;
let dbFailed = false;
try {
  // Custom format (-Fc): compressed, restorable table-by-table with pg_restore.
  execFileSync('pg_dump', ['--format=custom', `--file=${outFile}`, url], {
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 10 * 60_000,
  });
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`[backup] pg_dump FAILED: ${err.message}`);
    // Fall through to the scraper half — see below.
    dbFailed = true;
  } else {
    // pg_dump not installed (unelevated VM) — logical JSON fallback via pg over
    // TLS. Restore is manual per-table but the data is safe and off-Neon.
    console.warn('[backup] pg_dump not found — falling back to JSON table dump');
    usedFallback = true;
    try {
      await jsonDump(url, outFile.replace(/\.dump$/, '.json.gz'));
    } catch (dumpErr) {
      // The DATABASE half failed. The SCRAPER half must still run: it reads
      // local SQLite files and needs no database at all, so coupling the two
      // means an outage at the provider silently costs you the one backup the
      // provider cannot give back.
      //
      // Observed 2026-07-28: Neon hit its free-tier compute quota overnight,
      // this rejection propagated out of the top-level await, and the process
      // died BEFORE backupScraperState() — so neither artifact was written
      // that day, including the one that had nothing to do with Neon.
      console.error(`[backup] Database dump FAILED: ${dumpErr.message}`);
      dbFailed = true;
    }
  }
}

if (dbFailed) {
  // Still try the half that can succeed, then exit non-zero so the scheduled
  // task's log and the `backups` health check both record a partial run.
  backupScraperState();
  console.error('[backup] PARTIAL: scraper state attempted, database dump did NOT succeed');
  process.exit(1);
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

if (usedFallback) {
  // Must run before this early exit: on a VM without pg_dump (which is the
  // normal case here) the fallback path is the ONLY path, so anything after
  // this line never executes. The scraper backup silently did not run when
  // it lived further down — and the script still reported success.
  backupScraperState();
  process.exit(0);
}

const size = fs.statSync(outFile).size;
if (size < 10_000) {
  console.error(`[backup] Dump suspiciously small (${size} bytes) — treat as FAILED`);
  process.exit(1);
}
console.log(`[backup] OK: ${outFile} (${Math.round(size / 1024)} KB)`);

backupScraperState();

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
