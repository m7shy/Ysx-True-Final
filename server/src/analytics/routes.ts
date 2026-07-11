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

/** GET /api/analytics/summary — real lead-funnel metrics for the tenant. */
router.get('/summary', async (req: Request, res: Response) => {
  const db = tenantDb(requireUserId(req));

  const [dmsSent, replies, callsBooked, trials, clients] = await Promise.all([
    db.lead.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    db.trackingEvent.count({ where: { type: TrackingEventType.REPLIED } }),
    db.lead.count({ where: { status: { in: [LeadStatus.CALL_BOOKED, LeadStatus.TRIAL, LeadStatus.CLIENT_CLOSED] } } }),
    db.lead.count({ where: { status: { in: [LeadStatus.TRIAL, LeadStatus.CLIENT_CLOSED] } } }),
    db.lead.count({ where: { status: LeadStatus.CLIENT_CLOSED } }),
  ]);

  res.json({ dmsSent, replies, callsBooked, trials, clients });
});

export default router;
