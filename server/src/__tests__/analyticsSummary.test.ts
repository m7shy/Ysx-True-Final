// FILE: server/src/__tests__/analyticsSummary.test.ts
//
// GET /api/analytics/summary — the numbers the Analytics screen now renders.
//
// Untested until now, which mattered less while the screen ignored it: it showed
// services/mockZoho's fixture instead, alongside a "Sent Emails" figure padded by
// +142, a hardcoded 42.8% open rate and a bar chart of literal constants. The
// screen is wired to this endpoint now, so a regression here no longer produces
// an obvious blank — it produces confident, wrong figures that get acted on.
//
// What is actually worth pinning: which Lead statuses land in which funnel stage
// (they overlap deliberately — a CLIENT_CLOSED lead is also a booked call and a
// trial), and that ?days genuinely windows the query rather than being ignored.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

const { store, seen } = vi.hoisted(() => ({
  store: {
    users: new Map<string, any>(),
    leads: [] as any[],
    events: [] as any[],
    recipients: [] as any[],
  },
  /** Every `where` the route issued, so windowing can be asserted, not assumed. */
  seen: [] as any[],
}));

/** Minimal `where` matcher: status.in, and a createdAt/lastSentAt lower bound. */
function rowMatches(row: any, where: any = {}): boolean {
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  if (where.status && typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.type && row.type !== where.type) return false;
  for (const field of ['createdAt', 'lastSentAt']) {
    const cond = where[field];
    if (!cond) continue;
    if (cond.gte && !(row[field] >= cond.gte)) return false;
    if (cond.not === null && row[field] == null) return false;
  }
  return true;
}

vi.mock('../db/prisma.js', () => ({
  prisma: {
    user: { findUnique: async ({ where }: any) => store.users.get(where.id) ?? null },
  },
}));

vi.mock('../db/tenantDb.js', () => ({
  tenantDb: () => ({
    lead: {
      count: async ({ where }: any) => {
        seen.push({ model: 'lead', where });
        return store.leads.filter((r) => rowMatches(r, where)).length;
      },
    },
    trackingEvent: {
      count: async ({ where }: any) => {
        seen.push({ model: 'trackingEvent', where });
        return store.events.filter((r) => rowMatches(r, where)).length;
      },
    },
    campaignRecipient: {
      count: async ({ where }: any) => {
        seen.push({ model: 'campaignRecipient', where });
        return store.recipients.filter((r) => rowMatches(r, where)).length;
      },
    },
  }),
}));

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';

const USER_ID = 'u-analytics';
let token: string;

const OLD = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

beforeAll(() => {
  store.users.set(USER_ID, { id: USER_ID, status: 'ACTIVE', tokenVersion: 0 });
  token = signAccessToken({ userId: USER_ID, email: 'a@example.com', tokenVersion: 0 });

  store.leads = [
    { status: 'NEW', createdAt: RECENT },          // never counted — not yet contacted
    { status: 'CONTACTED', createdAt: RECENT },
    { status: 'REPLIED', createdAt: RECENT },
    { status: 'CALL_BOOKED', createdAt: RECENT },
    { status: 'TRIAL', createdAt: RECENT },
    { status: 'CLIENT_CLOSED', createdAt: RECENT },
    { status: 'LOST', createdAt: RECENT },
    { status: 'CONTACTED', createdAt: OLD },       // outside a 30-day window
  ];
  store.events = [
    { type: 'REPLIED', createdAt: RECENT },
    { type: 'OPENED', createdAt: RECENT },
    { type: 'OPENED', createdAt: RECENT },
    { type: 'CLICKED', createdAt: RECENT },
    { type: 'BOUNCED', createdAt: RECENT },
    { type: 'OPENED', createdAt: OLD },
  ];
  store.recipients = [
    { lastSentAt: RECENT },
    { lastSentAt: RECENT },
    { lastSentAt: OLD },
    { lastSentAt: null },                          // queued, never mailed
  ];
});

const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('GET /api/analytics/summary', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });

  it('counts the funnel from lead statuses, all-time by default', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.status).toBe(200);

    // Contacted = everything past NEW, LOST included: it was still mailed.
    expect(res.body.dmsSent).toBe(7);
    // Stages nest deliberately — a closed client is also a booked call and a trial.
    expect(res.body.callsBooked).toBe(3); // CALL_BOOKED + TRIAL + CLIENT_CLOSED
    expect(res.body.trials).toBe(2);      // TRIAL + CLIENT_CLOSED
    expect(res.body.clients).toBe(1);     // CLIENT_CLOSED
  });

  it('counts engagement from tracking events by type', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.body.replies).toBe(1);
    expect(res.body.opened).toBe(3);
    expect(res.body.clicked).toBe(1);
    expect(res.body.bounced).toBe(1);
  });

  it('counts only recipients actually mailed, not merely queued', async () => {
    // A recipient with lastSentAt null is scheduled, not sent. Counting it would
    // inflate the denominator of every rate the UI shows.
    const res = await get('/api/analytics/summary');
    expect(res.body.sent).toBe(3);
  });

  it('windows every count when ?days is given', async () => {
    const res = await get('/api/analytics/summary?days=30');
    expect(res.status).toBe(200);
    expect(res.body.dmsSent).toBe(6); // the 60-day-old CONTACTED lead drops out
    expect(res.body.opened).toBe(2);  // the 60-day-old OPENED drops out
    expect(res.body.sent).toBe(2);    // the 60-day-old send drops out
  });

  it('actually applies a lower bound rather than ignoring the parameter', async () => {
    // Guards the shape of the fix, not just its arithmetic: a `days` that parsed
    // but never reached the query would still return plausible-looking totals.
    seen.length = 0;
    await get('/api/analytics/summary?days=7');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((q) => Boolean(q.where.createdAt?.gte ?? q.where.lastSentAt?.gte))).toBe(true);
  });

  it('ignores a nonsensical days value and falls back to all-time', async () => {
    for (const bad of ['0', '-5', 'abc', '9999']) {
      const res = await get(`/api/analytics/summary?days=${bad}`);
      expect(res.status).toBe(200);
      expect(res.body.dmsSent).toBe(7);
    }
  });
});
