// Restore rehearsal: replay a backup-db.mjs JSON dump into a target Postgres.
// Usage: RESTORE_URL=<pg url> node restore-drill.mjs <dump.json.gz>
import { PrismaClient } from '@prisma/client';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';

const url = process.env.RESTORE_URL;
const dumpFile = process.argv[2];
const p = new PrismaClient({ datasources: { db: { url } } });

const dump = JSON.parse(gunzipSync(fs.readFileSync(dumpFile)).toString());
delete dump._prisma_migrations; // schema is rebuilt by `prisma migrate deploy`

// ── column types of the TARGET schema ────────────────────────────────────────
const cols = await p.$queryRawUnsafe(`
  SELECT table_name, column_name, data_type, udt_name
  FROM information_schema.columns WHERE table_schema='public'`);
const typeOf = new Map();
for (const c of cols) typeOf.set(`${c.table_name}.${c.column_name}`, c);

// ── topological order from the target's FK graph ─────────────────────────────
const fks = await p.$queryRawUnsafe(`
  SELECT tc.table_name AS child, ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`);
const tables = Object.keys(dump);
const deps = new Map(tables.map((t) => [t, new Set()]));
for (const { child, parent } of fks) {
  if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
}
const order = [];
const seen = new Set();
while (order.length < tables.length) {
  const next = tables.filter((t) => !seen.has(t) && [...deps.get(t)].every((d) => seen.has(d)));
  if (!next.length) { console.error('CYCLE among', tables.filter((t) => !seen.has(t))); break; }
  for (const t of next) { order.push(t); seen.add(t); }
}

function lit(v, meta) {
  if (v === null || v === undefined) return { sql: 'NULL', param: undefined };
  const dt = meta.data_type;
  if (dt === 'ARRAY') {
    const inner = meta.udt_name.replace(/^_/, '');
    return { sql: `::text::${inner}[]`, param: `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}` };
  }
  if (dt === 'jsonb' || dt === 'json') return { sql: `::text::${dt}`, param: JSON.stringify(v) };
  if (dt === 'USER-DEFINED') return { sql: `::text::"${meta.udt_name}"`, param: String(v) };
  if (dt.startsWith('timestamp') || dt === 'date') return { sql: `::text::${meta.udt_name}`, param: String(v) };
  if (dt === 'boolean') return { sql: '::text::boolean', param: String(v) };
  if (['integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real'].includes(dt))
    return { sql: `::text::${meta.udt_name}`, param: String(v) };
  return { sql: '', param: String(v) };
}

let total = 0;
const report = [];
for (const table of order) {
  const rows = dump[table];
  if (!rows.length) { report.push([table, 0, 'ok (empty)']); continue; }
  let ok = 0; let firstErr = null;
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => typeOf.has(`${table}.${k}`));
    const dropped = Object.keys(row).filter((k) => !typeOf.has(`${table}.${k}`));
    if (dropped.length) firstErr ??= `columns not in target schema: ${dropped.join(',')}`;
    const params = [];
    const placeholders = keys.map((k) => {
      const { sql, param } = lit(row[k], typeOf.get(`${table}.${k}`));
      if (param === undefined) return 'NULL';
      params.push(param);
      return `$${params.length}${sql}`;
    });
    const stmt = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${placeholders.join(',')})`;
    try { await p.$executeRawUnsafe(stmt, ...params); ok++; }
    catch (e) { firstErr ??= e.message.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 220); }
  }
  total += ok;
  report.push([table, `${ok}/${rows.length}`, firstErr ?? 'ok']);
}

console.log('\n=== RESTORE RESULT (order = FK topological) ===');
for (const [t, n, s] of report) console.log(String(n).padStart(8), t.padEnd(22), s);
console.log('rows inserted:', total);
await p.$disconnect();
