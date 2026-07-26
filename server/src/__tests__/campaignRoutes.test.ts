import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

/**
 * In-memory Prisma stand-in covering exactly what campaigns/routes.ts (via
 * tenantDb) and the auth/tenantGate middleware touch, so these run as real
 * HTTP requests through the actual Express app + tenantDb extension — the
 * same code path production traffic hits — without a database.
 */
const { store } = vi.hoisted(() => ({
  store: {
    users: new Map<string, any>(),
    campaigns: new Map<string, any>(),
    campaignRecipients: new Map<string, any>(),
    leads: new Map<string, any>(),
    seq: 1,
  },
}));

function nextId(prefix: string): string {
  return `${prefix}${store.seq++}`;
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  if (where.AND) return (where.AND as any[]).every((w) => matchesWhere(row, w));
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
    return row[k] === v;
  });
}

/**
 * Minimal, faithful stand-in for Prisma's `$extends`: tenantDb.ts calls
 * `prisma.$extends({ query: { $allModels: { $allOperations(...) } } })`, so
 * the mock must actually run that interceptor (which does the tenant `where`/
 * `data` scoping) around each mocked model method — not just return `this` —
 * or the cross-tenant isolation test below would pass for the wrong reason.
 */
function extendable<T extends Record<string, Record<string, (...a: any[]) => any>>>(base: T): T {
  const withExtends: any = { ...base };
  withExtends.$extends = (ext: any) => {
    const wrapped: any = {};
    for (const modelKey of Object.keys(base)) {
      wrapped[modelKey] = {};
      const modelName = modelKey.charAt(0).toUpperCase() + modelKey.slice(1);
      for (const opName of Object.keys((base as any)[modelKey])) {
        wrapped[modelKey][opName] = (args: any) =>
          ext.query.$allModels.$allOperations({
            model: modelName,
            operation: opName,
            args,
            query: (a: any) => (base as any)[modelKey][opName](a),
          });
      }
    }
    return extendable(wrapped);
  };
  return withExtends;
}

vi.mock('../db/prisma.js', () => ({
  prisma: extendable({
    user: {
      findUnique: async ({ where }: any) => store.users.get(where.id) ?? null,
    },
    campaign: {
      create: async ({ data }: any) => {
        const row = { id: nextId('c'), createdAt: new Date(), updatedAt: new Date(), progress: 0, sentCount: 0, clickedCount: 0, repliedCount: 0, opportunitiesCount: 0, sentToday: 0, counterDate: new Date(), stopOnReply: true, openTracking: false, linkTracking: false, ...data };
        store.campaigns.set(row.id, row);
        return row;
      },
      findFirst: async ({ where }: any) => [...store.campaigns.values()].find((c) => matchesWhere(c, where)) ?? null,
      findMany: async ({ where }: any) => [...store.campaigns.values()].filter((c) => matchesWhere(c, where)),
      update: async ({ where, data }: any) => {
        const row = store.campaigns.get(where.id);
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const row = store.campaigns.get(where.id);
        store.campaigns.delete(where.id);
        return row;
      },
    },
    campaignRecipient: {
      createMany: async ({ data }: any) => {
        const rows = Array.isArray(data) ? data : [data];
        for (const d of rows) {
          const row = { id: nextId('cr'), status: 'PENDING', currentStep: 0, attemptCount: 0, createdAt: new Date(), updatedAt: new Date(), ...d };
          store.campaignRecipients.set(row.id, row);
        }
        return { count: rows.length };
      },
      findMany: async ({ where }: any) => [...store.campaignRecipients.values()].filter((r) => matchesWhere(r, where)),
    },
    lead: {
      upsert: async ({ where, create, update }: any) => {
        const key = where.userId_email;
        const existing = [...store.leads.values()].find((l) => l.userId === key.userId && l.email === key.email);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId('l'), createdAt: new Date(), updatedAt: new Date(), isBounced: false, bounceCount: 0, ...create };
        store.leads.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return store.leads.get(where.id) ?? null;
        const key = where.userId_email;
        return [...store.leads.values()].find((l) => l.userId === key.userId && l.email === key.email) ?? null;
      },
      findMany: async ({ where }: any) => [...store.leads.values()].filter((l) => matchesWhere(l, where)),
    },
  }),
}));

// Record follow-up cancellations so the pause-vs-delete distinction can be
// asserted. Partial mock: everything else keeps its real implementation.
const { cancelCampaignCalls } = vi.hoisted(() => ({ cancelCampaignCalls: [] as any[] }));
vi.mock('../scheduler/followupScheduler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduler/followupScheduler.js')>();
  return {
    ...actual,
    cancelScheduledFollowupsForCampaign: vi.fn(async (campaignId: string, reason?: string) => {
      cancelCampaignCalls.push({ campaignId, reason });
      return 0;
    }),
  };
});

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';

const USER_ID = 'u1';
let token: string;

beforeAll(() => {
  store.users.set(USER_ID, { id: USER_ID, status: 'ACTIVE', tokenVersion: 0 });
  token = signAccessToken({ userId: USER_ID, email: 'u1@example.com', tokenVersion: 0 });
});

function authed(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('POST /api/campaigns validation', () => {
  it('rejects a malformed autoFollowUps entry', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: 'Test',
      autoFollowUps: [{ delay: 'not-a-number', unit: 'DAYS', content: 'hi' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('rejects an autoFollowUps unit outside the enum', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: 'Test',
      autoFollowUps: [{ delay: 3, unit: 'FORTNIGHTS', content: 'hi' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a garbage scheduledAt', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: 'Test',
      scheduledAt: 'not-a-real-date',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a distributionMethod outside INDIVIDUAL/GROUP', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: 'Test',
      distributionMethod: 'BROADCAST',
    });
    expect(res.status).toBe(400);
  });

  it('rejects dailyLimit outside the allowed range', async () => {
    const res = await authed('post', '/api/campaigns').send({ name: 'Test', dailyLimit: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects a followUpPercent outside 0-100', async () => {
    const res = await authed('post', '/api/campaigns').send({ name: 'Test', followUpPercent: 150 });
    expect(res.status).toBe(400);
  });

  it('rejects a sendIntervalMinutes of 0 (must be at least 1)', async () => {
    const res = await authed('post', '/api/campaigns').send({ name: 'Test', sendIntervalMinutes: 0 });
    expect(res.status).toBe(400);
  });

  it('accepts the campaign wizard extended fields', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: 'Test',
      sendIntervalMinutes: 20,
      stopOnClick: true,
      stopOnOpen: true,
      plainTextMode: true,
      followUpPercent: 75,
    });
    expect(res.status).toBe(201);
    expect(res.body.campaign.sendIntervalMinutes).toBe(20);
    expect(res.body.campaign.stopOnClick).toBe(true);
    expect(res.body.campaign.stopOnOpen).toBe(true);
    expect(res.body.campaign.plainTextMode).toBe(true);
    expect(res.body.campaign.followUpPercent).toBe(75);
  });

  it('accepts a well-formed campaign and links CampaignRecipient rows for its recipients', async () => {
    const res = await authed('post', '/api/campaigns').send({
      name: '[TEST] campaign',
      subject: 'Hi',
      body: 'Body',
      distributionMethod: 'INDIVIDUAL',
      stopOnReply: true,
      dailyLimit: 25,
      recipients: [{ email: 'lead1@example.com', name: 'Lead One' }],
    });
    expect(res.status).toBe(201);
    const campaignId = res.body.campaign.id;

    const recipients = [...store.campaignRecipients.values()].filter((r) => r.campaignId === campaignId);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].userId).toBe(USER_ID);
    expect(recipients[0].status).toBe('PENDING');

    const lead = store.leads.get(recipients[0].leadId);
    expect(lead?.email).toBe('lead1@example.com');
    expect(lead?.status).toBe('NEW');
  });

  it('stores recipient customFields on the Lead and shallow-merges them on re-import', async () => {
    await authed('post', '/api/campaigns').send({
      name: '[TEST] custom fields 1',
      recipients: [{ email: 'custom@example.com', name: 'Custom Lead', customFields: { timestamp_1: '0:42', problem_1: 'jump cut' } }],
    });
    const leadAfterFirst = [...store.leads.values()].find((l) => l.email === 'custom@example.com');
    expect(leadAfterFirst?.customFields).toEqual({ timestamp_1: '0:42', problem_1: 'jump cut' });

    await authed('post', '/api/campaigns').send({
      name: '[TEST] custom fields 2',
      recipients: [{ email: 'custom@example.com', name: 'Custom Lead', customFields: { timestamp_1: '1:10', first_name: 'Jamie' } }],
    });
    const leadAfterSecond = [...store.leads.values()].find((l) => l.email === 'custom@example.com');
    // New import wins per-key (timestamp_1 updated), old keys not present in the new import are kept (problem_1).
    expect(leadAfterSecond?.customFields).toEqual({ timestamp_1: '1:10', problem_1: 'jump cut', first_name: 'Jamie' });
  });

  it('updates name/company on re-import but never clobbers them with empty values', async () => {
    await authed('post', '/api/campaigns').send({
      name: '[TEST] reimport 1',
      recipients: [{ email: 'reimport@example.com', name: 'Old Name', company: 'Old Co' }],
    });

    // Re-import with a fresh name but no company: name updates, company survives.
    await authed('post', '/api/campaigns').send({
      name: '[TEST] reimport 2',
      recipients: [{ email: 'reimport@example.com', name: 'New Name', company: '' }],
    });
    const lead = [...store.leads.values()].find((l) => l.email === 'reimport@example.com');
    expect(lead?.name).toBe('New Name');
    expect(lead?.company).toBe('Old Co');
  });
});

describe('GET /api/campaigns/:id/recipients', () => {
  it('joins recipient rows with lead details and supports CSV format', async () => {
    const createRes = await authed('post', '/api/campaigns').send({
      name: '[TEST] csv campaign',
      recipients: [{ email: 'csv-lead@example.com', name: 'CSV Lead', company: 'Acme' }],
    });
    const campaignId = createRes.body.campaign.id;

    const jsonRes = await authed('get', `/api/campaigns/${campaignId}/recipients`);
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.recipients).toHaveLength(1);
    expect(jsonRes.body.recipients[0].email).toBe('csv-lead@example.com');

    const csvRes = await authed('get', `/api/campaigns/${campaignId}/recipients?format=csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(csvRes.text).toContain('csv-lead@example.com');
  });

  it('404s for a campaign belonging to another tenant', async () => {
    const otherUserId = 'u2';
    store.users.set(otherUserId, { id: otherUserId, status: 'ACTIVE', tokenVersion: 0 });
    const otherToken = signAccessToken({ userId: otherUserId, email: 'u2@example.com', tokenVersion: 0 });

    const createRes = await authed('post', '/api/campaigns').send({ name: '[TEST] isolation' });
    const campaignId = createRes.body.campaign.id;

    const res = await request(app)
      .get(`/api/campaigns/${campaignId}/recipients`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});

describe('pausing suspends follow-ups instead of destroying them', () => {
  // Pausing used to call cancelScheduledFollowupsForCampaign(), which stopped
  // the sends but was irreversible: resume could not bring the sequence back,
  // so pausing a campaign for an hour silently lost every queued follow-up.
  // The send path now declines while a campaign is not ACTIVE, so nothing
  // sends while paused AND nothing is thrown away.
  it('does NOT cancel scheduled follow-ups when a campaign is paused', async () => {
    const createRes = await authed('post', '/api/campaigns').send({ name: '[TEST] pause' });
    const campaignId = createRes.body.campaign.id;
    cancelCampaignCalls.length = 0;

    const res = await authed('patch', `/api/campaigns/${campaignId}`).send({ status: 'PAUSED' });
    expect(res.status).toBe(200);

    expect(cancelCampaignCalls).toHaveLength(0);
  });

  // Deleting is different: the campaign really is gone, so its queued
  // follow-ups must not survive it.
  it('DOES cancel scheduled follow-ups when a campaign is deleted', async () => {
    const createRes = await authed('post', '/api/campaigns').send({ name: '[TEST] delete' });
    const campaignId = createRes.body.campaign.id;
    cancelCampaignCalls.length = 0;

    const res = await authed('delete', `/api/campaigns/${campaignId}`);
    expect(res.status).toBe(200);

    expect(cancelCampaignCalls).toHaveLength(1);
    expect(cancelCampaignCalls[0]).toMatchObject({ campaignId, reason: 'campaign_deleted' });
  });
});

describe('send window must be configured at both ends', () => {
  // isWithinSendWindow() only applies a window when BOTH ends are non-null, so
  // storing one without the other produced a setting that silently did nothing
  // — the campaign sent around the clock while the UI showed a start time.
  it('rejects a start without an end', async () => {
    const res = await authed('post', '/api/campaigns').send({ name: '[TEST] w', sendWindowStart: 540 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toMatch(/sendWindow/i);
  });

  it('rejects an end without a start', async () => {
    const res = await authed('post', '/api/campaigns').send({ name: '[TEST] w', sendWindowEnd: 1020 });
    expect(res.status).toBe(400);
  });

  it('accepts both together, and neither', async () => {
    const both = await authed('post', '/api/campaigns').send({
      name: '[TEST] w', sendWindowStart: 540, sendWindowEnd: 1020,
    });
    expect(both.status).toBe(201);
    const neither = await authed('post', '/api/campaigns').send({ name: '[TEST] w2' });
    expect(neither.status).toBe(201);
  });
});
