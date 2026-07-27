// FILE: server/src/leads/importService.ts

import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

import { tenantDb } from '../db/tenantDb.js';
import { logger } from '../logger.js';
import { partitionSuppressed } from './suppression.js';

/**
 * Shared lead-ingest core. Both entry points that write *scraped* leads into a
 * tenant use this:
 *
 *   - leads/importRoutes.ts   — the server-to-server X-Import-Key endpoint the
 *                               standalone crm_importer.py CLI still POSTs to.
 *   - scraper/service.ts      — the in-app scraper: after a user-triggered run
 *                               finishes, the job reads that profile's leads.csv
 *                               and feeds the rows straight in here for the
 *                               logged-in tenant (no HTTP round-trip, no shared
 *                               secret — the backend already knows the userId).
 *
 * Keeping the schema and the find-then-write upsert in one place means the two
 * paths can never drift on how a scraped row becomes a Lead.
 */

// One scraper row. Mirrors the emitter in YT-Scraper/main.py (url, email,
// avg_views, social_links, external_links, priority_lane,
// recent_video_transcript). name/subscribers/niche are accepted when present.
// Unknown keys are ignored so the payload can grow without breaking ingest.
export const scraperRowSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    url: z.string().trim().optional(),
    name: z.string().trim().min(1).optional(),
    subscribers: z.coerce.number().int().nonnegative().optional(),
    avg_views: z.coerce.number().int().nonnegative().optional(),
    social_links: z.string().optional(),
    external_links: z.string().optional(),
    priority_lane: z.string().optional(),
    recent_video_transcript: z.string().optional(),
    custom_first_line: z.string().optional(),
    niche: z.string().optional(),
  })
  .passthrough();

export type ScraperRow = z.infer<typeof scraperRowSchema>;

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors: Array<{ email: string; message: string }>;
}

/** Derive a non-empty display name: explicit name → channel handle → email local part. */
function deriveName(row: ScraperRow): string {
  if (row.name) return row.name;
  if (row.url) {
    const tail = row.url.replace(/\/+$/, '').split('/').pop();
    if (tail) return decodeURIComponent(tail);
  }
  return row.email.split('@')[0];
}

/**
 * Scraped intelligence blob. Kept under Lead.intelligence (Json) so no schema
 * migration is needed and the shape can evolve. recentVideoTranscript is
 * preserved verbatim so a downstream first-line generator has raw material.
 */
function buildIntelligence(row: ScraperRow, niche?: string) {
  const intel: Record<string, unknown> = {};
  if (row.url !== undefined) intel.channelUrl = row.url;
  if (row.subscribers !== undefined) intel.subscribers = row.subscribers;
  if (row.avg_views !== undefined) intel.avgViews = row.avg_views;
  if (row.social_links) intel.socialLinks = row.social_links;
  if (row.external_links) intel.externalLinks = row.external_links;
  if (row.priority_lane) intel.priorityLane = row.priority_lane;
  if (row.recent_video_transcript) intel.recentVideoTranscript = row.recent_video_transcript;
  if (row.custom_first_line) intel.customFirstLine = row.custom_first_line;
  const n = row.niche ?? niche;
  if (n) intel.niche = n;
  return intel;
}

/**
 * Upsert scraped rows into one tenant's leads, idempotent by (tenant, email).
 * A row whose email already exists refreshes that lead's scraped stats
 * (intelligence merged so fields not sent this run survive); a new email is
 * created as a NEW lead. Every write goes through tenantDb(userId), the same
 * force-scoped Prisma extension the authenticated routes use, so imported leads
 * can never leak across tenants.
 */
export async function importLeadRows(
  userId: string,
  rows: ScraperRow[],
  runNiche?: string,
): Promise<ImportSummary> {
  const db = tenantDb(userId);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ email: string; message: string }> = [];

  // Drop suppressed addresses BEFORE anything is written.
  //
  // This is the import half of the reason Suppression exists at all: an
  // opt-out recorded against a Lead row dies with that row, so someone who
  // unsubscribed in March comes back as a brand-new NEW lead the next time the
  // scraper finds the same channel. Filtering at write time — not at send time
  // only — also means we never re-store personal data for someone who asked us
  // to erase it. One query for the whole batch, not one per row.
  const { suppressed } = await partitionSuppressed(
    userId,
    rows.map((r) => r.email),
  );
  const blocked = new Set(suppressed.map((e) => e.trim().toLowerCase()));
  if (blocked.size > 0) {
    skipped += blocked.size;
    logger.info({ userId, count: blocked.size }, 'Import skipped suppressed addresses');
  }

  for (const row of rows) {
    if (blocked.has(row.email.trim().toLowerCase())) continue;
    try {
      const intelligence = buildIntelligence(row, runNiche);
      const source = row.niche ?? runNiche ?? 'youtube-scraper';

      const existing = await db.lead.findFirst({ where: { email: row.email } });

      if (existing) {
        const mergedIntel = {
          ...(existing.intelligence && typeof existing.intelligence === 'object'
            ? (existing.intelligence as Record<string, unknown>)
            : {}),
          ...intelligence,
        };
        await db.lead.update({
          where: { id: existing.id },
          data: { intelligence: mergedIntel, source },
        });
        updated += 1;
      } else {
        await db.lead.create({
          data: {
            userId,
            name: deriveName(row),
            email: row.email,
            status: LeadStatus.NEW,
            source,
            score: row.avg_views,
            intelligence,
          },
        });
        created += 1;
      }
    } catch (err) {
      skipped += 1;
      errors.push({ email: row.email, message: err instanceof Error ? err.message : 'write failed' });
    }
  }

  return { created, updated, skipped, total: rows.length, errors };
}
