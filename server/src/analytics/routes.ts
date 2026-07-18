// FILE: server/src/analytics/routes.ts

import express, { Request, Response } from 'express';
import { LeadStatus, TrackingEventType } from '@prisma/client';

import { tenantDb } from '../db/tenantDb.js';
import { requireUserId } from '../auth/middleware.js';

/**
 * Real replacement for services/mockZoho.ts's getFunnelMetrics(), which
 * AnalyticsView rendered unconditionally regardless of whether the tenant
 * had any real data. This is backed entirely by existing Lead.status and
 * TrackingEvent rows — no new tracking infrastructure needed.
 *
 * (PerformanceView is a separate, unrelated legacy mock — client video-editing
 * project fees/hours/revisions — with no corresponding data model in this
 * CRM's schema; it is out of scope here, see HANDOFF notes.)
 */

const router = express.Router();

const ACTIVE_STATUSES: LeadStatus[] = [
  LeadStatus.CONTACTED,
  LeadStatus.REPLIED,
  LeadStatus.CALL_BOOKED,
  LeadStatus.TRIAL,
  LeadStatus.CLIENT_CLOSED,
  LeadStatus.LOST,
];

/** Parse ?days=7|30|90 into a lower-bound Date, or null for all-time. */
function parseSince(raw: unknown): Date | null {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 365) return null;
  return new Date(Date.now() - Math.floor(n) * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/analytics/summary?days=30 — real funnel + engagement metrics.
 *
 * Funnel counts come from Lead.status; engagement counts from TrackingEvent
 * (opens/clicks/bounces from the tracking pixel + click redirect + bounce
 * handler, replies from the unibox poller). `sent` counts campaign recipients
 * actually mailed at least once (lastSentAt) since no SENT tracking events
 * are recorded. Without ?days, everything is all-time.
 */
router.get('/summary', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));
  const since = parseSince(req.query.days);

  const leadWindow = since ? { createdAt: { gte: since } } : {};
  const eventWindow = since ? { createdAt: { gte: since } } : {};

  const eventCount = (type: TrackingEventType) =>
    db.trackingEvent.count({ where: { type, ...eventWindow } });

  const [dmsSent, replies, callsBooked, trials, clients, sent, opened, clicked, bounced] =
    await Promise.all([
      db.lead.count({ where: { status: { in: ACTIVE_STATUSES }, ...leadWindow } }),
      eventCount(TrackingEventType.REPLIED),
      db.lead.count({ where: { status: { in: [LeadStatus.CALL_BOOKED, LeadStatus.TRIAL, LeadStatus.CLIENT_CLOSED] }, ...leadWindow } }),
      db.lead.count({ where: { status: { in: [LeadStatus.TRIAL, LeadStatus.CLIENT_CLOSED] }, ...leadWindow } }),
      db.lead.count({ where: { status: LeadStatus.CLIENT_CLOSED, ...leadWindow } }),
      db.campaignRecipient.count({
        where: { lastSentAt: since ? { gte: since } : { not: null } },
      }),
      eventCount(TrackingEventType.OPENED),
      eventCount(TrackingEventType.CLICKED),
      eventCount(TrackingEventType.BOUNCED),
    ]);

  res.json({ dmsSent, replies, callsBooked, trials, clients, sent, opened, clicked, bounced });
});

export default router;
