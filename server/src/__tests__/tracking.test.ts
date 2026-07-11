import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { store } = vi.hoisted(() => ({
  store: {
    recipients: new Map<string, any>(),
    events: [] as any[],
    campaigns: new Map<string, any>(),
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
      findUnique: async ({ where }: any) => ({ id: where.id, email: 'lead@example.com' }),
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

vi.mock('../scheduler/followupScheduler.js', () => ({
  cancelRemainingFollowupsForRecipient: vi.fn(async () => {}),
}));

import trackingRouter from '../campaigns/trackingRoutes.js';
import { signTrackingToken } from '../campaigns/trackingToken.js';

const app = express();
app.use('/t', trackingRouter);

beforeEach(() => {
  store.recipients.clear();
  store.campaigns.clear();
  store.events.length = 0;
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
