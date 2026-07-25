import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { store } = vi.hoisted(() => ({
  store: {
    recipients: new Map<string, any>(),
    events: [] as any[],
    campaigns: new Map<string, any>(),
    leads: new Map<string, any>(),
    seq: 1,
  },
}));

function nextId(prefix: string): string {
  return `${prefix}${store.seq++}`;
}

vi.mock('../db/prisma.js', () => ({
  prisma: {
    campaignRecipient: {
      findUnique: async ({ where }: any) => store.recipients.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = store.recipients.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    lead: {
      findUnique: async ({ where }: any) => store.leads.get(where.id) ?? { id: where.id, email: 'lead@example.com', status: 'NEW' },
      update: async ({ where, data }: any) => {
        const existing = store.leads.get(where.id) ?? { id: where.id, email: 'lead@example.com', status: 'NEW' };
        const updated = { ...existing, ...data };
        store.leads.set(where.id, updated);
        return updated;
      },
    },
    trackingEvent: {
      findFirst: async ({ where }: any) =>
        store.events.find((e) => e.leadId === where.leadId && e.campaignId === where.campaignId && e.type === where.type) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextId('te'), createdAt: new Date(), ...data };
        store.events.push(row);
        return row;
      },
    },
    campaign: {
      update: async ({ where, data }: any) => {
        const row = store.campaigns.get(where.id) ?? { id: where.id, clickedCount: 0, stopOnClick: false, stopOnOpen: false };
        if (data.clickedCount?.increment) row.clickedCount += data.clickedCount.increment;
        store.campaigns.set(where.id, row);
        return row;
      },
      findUnique: async ({ where }: any) => store.campaigns.get(where.id) ?? null,
    },
  },
}));

vi.mock('../leads/dnc.js', () => ({
  // enforceDnc cancels follow-ups and skips pending recipients; for these
  // route-level tests we only need to confirm it is called (POST) or not (GET).
  enforceDnc: vi.fn(async () => {}),
}));

vi.mock('../scheduler/followupScheduler.js', () => ({
  cancelRemainingFollowupsForRecipient: vi.fn(async () => {}),
}));

import trackingRouter from '../campaigns/trackingRoutes.js';
import { signTrackingToken } from '../campaigns/trackingToken.js';
import { enforceDnc } from '../leads/dnc.js';

const app = express();
app.use('/t', trackingRouter);

beforeEach(() => {
  store.recipients.clear();
  store.campaigns.clear();
  store.leads.clear();
  store.events.length = 0;
  vi.clearAllMocks();
});

function seedRecipient(id: string, overrides: Partial<{ status: string; stopOnClick: boolean; stopOnOpen: boolean }> = {}) {
  store.campaigns.set('camp1', { id: 'camp1', clickedCount: 0, stopOnClick: false, stopOnOpen: false, ...overrides });
  store.recipients.set(id, {
    id,
    campaignId: 'camp1',
    leadId: 'lead1',
    userId: 'user1',
    status: overrides.status ?? 'PENDING',
    campaign: { id: 'camp1', stopOnClick: overrides.stopOnClick ?? false, stopOnOpen: overrides.stopOnOpen ?? false },
  });
}

describe('GET /t/o/:token (open pixel)', () => {
  it('returns a GIF and records an OPENED event for a valid token', async () => {
    seedRecipient('r1');
    const token = signTrackingToken('r1');

    const res = await request(app).get(`/t/o/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(store.events).toHaveLength(1);
    expect(store.events[0].type).toBe('OPENED');
  });

  it('still returns a GIF for a bad/forged token, without recording an event', async () => {
    const res = await request(app).get('/t/o/garbage.token');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(store.events).toHaveLength(0);
  });

  it('dedupes repeated opens within the 5-minute window', async () => {
    seedRecipient('r1');
    const token = signTrackingToken('r1');
    await request(app).get(`/t/o/${token}`);
    await request(app).get(`/t/o/${token}`);
    expect(store.events).toHaveLength(1);
  });

  it('completes the recipient and cancels follow-ups when stopOnOpen is set', async () => {
    seedRecipient('r1', { stopOnOpen: true });
    const token = signTrackingToken('r1');
    await request(app).get(`/t/o/${token}`);
    expect(store.recipients.get('r1').status).toBe('COMPLETED');
  });
});

describe('GET /t/c/:token (click redirect)', () => {
  function encodedUrl(url: string): string {
    return Buffer.from(url).toString('base64url');
  }

  it('records a CLICKED event, increments clickedCount, and redirects', async () => {
    seedRecipient('r1');
    const token = signTrackingToken('r1');
    const res = await request(app).get(`/t/c/${token}?u=${encodedUrl('https://example.com/page')}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/page');
    expect(store.events).toHaveLength(1);
    expect(store.events[0].type).toBe('CLICKED');
    expect(store.campaigns.get('camp1').clickedCount).toBe(1);
  });

  it('still redirects for a bad token, without recording an event', async () => {
    const res = await request(app).get(`/t/c/garbage.token?u=${encodedUrl('https://example.com')}`);
    expect(res.status).toBe(302);
    expect(store.events).toHaveLength(0);
  });

  it('rejects a non-http(s) target URL', async () => {
    const res = await request(app).get(`/t/c/anything?u=${encodedUrl('javascript:alert(1)')}`);
    expect(res.status).toBe(400);
  });

  it('completes the recipient and cancels follow-ups when stopOnClick is set', async () => {
    seedRecipient('r1', { stopOnClick: true });
    const token = signTrackingToken('r1');
    await request(app).get(`/t/c/${token}?u=${encodedUrl('https://example.com')}`);
    expect(store.recipients.get('r1').status).toBe('COMPLETED');
  });
});

// ── Unsubscribe (/t/u/:token) ─────────────────────────────────────────────────

describe('GET /t/u/:token (unsubscribe confirmation form)', () => {
  it('returns 200 and an HTML form for a valid token WITHOUT mutating the lead', async () => {
    seedRecipient('r1');
    const token = signTrackingToken('r1');

    const res = await request(app).get(`/t/u/${token}`);

    expect(res.status).toBe(200);
    // Must be an HTML page with a form, not a "you've been unsubscribed" confirmation.
    expect(res.text).toContain('<form');
    expect(res.text).toContain('Confirm unsubscribe');
    expect(res.text).not.toContain("You've been unsubscribed");

    // The lead must NOT have been mutated — the whole point of the fix is that
    // automated link-scanner GETs must not trigger the unsubscribe.
    expect(enforceDnc).not.toHaveBeenCalled();
    expect(store.leads.size).toBe(0); // no lead.update was issued
  });

  it('returns 404 for an invalid/forged token without touching the lead', async () => {
    const res = await request(app).get('/t/u/garbage.token');
    expect(res.status).toBe(404);
    expect(enforceDnc).not.toHaveBeenCalled();
  });
});

describe('POST /t/u/:token (one-click unsubscribe)', () => {
  it('sets the lead to DNC and returns the confirmation page', async () => {
    seedRecipient('r1');
    const token = signTrackingToken('r1');

    const res = await request(app).post(`/t/u/${token}`);

    expect(res.status).toBe(200);
    // A human who submitted the confirmation form must see a proper page.
    expect(res.text).toContain("You've been unsubscribed");
    // enforceDnc must have been called to cancel follow-ups and skip pending recipients.
    expect(enforceDnc).toHaveBeenCalledOnce();
  });

  it('is idempotent: a second POST on the same token still returns 200', async () => {
    seedRecipient('r1');
    // Seed the lead in DNC state (as it would be after the first POST).
    store.leads.set('lead1', { id: 'lead1', email: 'lead@example.com', status: 'DNC' });
    const token = signTrackingToken('r1');

    const res = await request(app).post(`/t/u/${token}`);

    expect(res.status).toBe(200);
    // enforceDnc is still called on the second POST — it's idempotent internally.
    expect(enforceDnc).toHaveBeenCalledOnce();
  });

  it('returns 404 for an invalid/forged token', async () => {
    const res = await request(app).post('/t/u/garbage.token');
    expect(res.status).toBe(404);
    expect(enforceDnc).not.toHaveBeenCalled();
  });
});
