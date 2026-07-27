import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * DNC (do-not-contact) enforcement: marking a lead DNC — from the Leads view
 * (PATCH /api/leads/:id) or from a unibox thread (PATCH
 * /api/unibox/threads/:id/lead-status) — must cancel every scheduled
 * follow-up job for that email and skip every PENDING campaign-recipient row,
 * so the lead is never contacted again.
 */
const { store } = vi.hoisted(() => ({
  store: {
    users: new Map<string, any>(),
    leads: new Map<string, any>(),
    campaignRecipients: new Map<string, any>(),
    followupJobs: new Map<string, any>(),
    /** "<userId>:<emailHash>" — the permanent opt-out list enforceDnc writes to. */
    suppressions: new Set<string>(),
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
    if (v && typeof v === 'object' && 'equals' in (v as any)) {
      const val = (v as any).equals;
      if ((v as any).mode === 'insensitive' && typeof val === 'string' && typeof row[k] === 'string') {
        return row[k].toLowerCase() === val.toLowerCase();
      }
      return row[k] === val;
    }
    if (v && typeof v === 'object' && 'not' in (v as any)) return row[k] !== (v as any).not;
    return row[k] === v;
  });
}

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
    lead: {
      // Return a snapshot, like real Prisma — routes compare pre-update state.
      findFirst: async ({ where }: any) => {
        const row = [...store.leads.values()].find((l) => matchesWhere(l, where));
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return store.leads.get(where.id) ?? null;
        const key = where.userId_email;
        return [...store.leads.values()].find((l) => l.userId === key.userId && l.email === key.email) ?? null;
      },
      findMany: async ({ where }: any) => [...store.leads.values()].filter((l) => matchesWhere(l, where)),
      update: async ({ where, data }: any) => {
        const row = store.leads.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    campaignRecipient: {
      findMany: async ({ where }: any) => [...store.campaignRecipients.values()].filter((r) => matchesWhere(r, where)),
      updateMany: async ({ where, data }: any) => {
        const rows = [...store.campaignRecipients.values()].filter((r) => matchesWhere(r, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    followupJob: {
      findMany: async ({ where, select }: any) => [...store.followupJobs.values()].filter((j) => matchesWhere(j, where)),
      updateMany: async ({ where, data }: any) => {
        const rows = [...store.followupJobs.values()].filter((j) => matchesWhere(j, where));
        for (const j of rows) Object.assign(j, data);
        return { count: rows.length };
      },
    },
    suppression: {
      findUnique: async ({ where }: any) => {
        const { userId, emailHash } = where.userId_emailHash;
        return store.suppressions.has(`${userId}:${emailHash}`) ? { id: 'sup' } : null;
      },
      upsert: async ({ where }: any) => {
        const { userId, emailHash } = where.userId_emailHash;
        store.suppressions.add(`${userId}:${emailHash}`);
        return { id: 'sup' };
      },
    },
  }),
}));

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';

const USER_ID = 'u1';
let token: string;

beforeAll(() => {
  store.users.set(USER_ID, { id: USER_ID, status: 'ACTIVE', tokenVersion: 0 });
  token = signAccessToken({ userId: USER_ID, email: 'u1@example.com', tokenVersion: 0 });
});

function seedLeadWithQueuedSends() {
  const leadId = nextId('l');
  store.leads.set(leadId, {
    id: leadId,
    userId: USER_ID,
    email: 'dnc-target@example.com',
    name: 'DNC Target',
    company: 'Acme',
    status: 'CONTACTED',
    intelligence: null,
    isBounced: false,
  });
  const crId = nextId('cr');
  store.campaignRecipients.set(crId, {
    id: crId,
    userId: USER_ID,
    leadId,
    campaignId: 'camp1',
    status: 'PENDING',
  });
  const jobId = nextId('fj');
  store.followupJobs.set(jobId, {
    id: jobId,
    userId: USER_ID,
    campaignId: 'camp1',
    recipientEmail: 'dnc-target@example.com',
    status: 'SCHEDULED',
  });
  return { leadId, crId, jobId };
}

beforeEach(() => {
  store.leads.clear();
  store.campaignRecipients.clear();
  store.followupJobs.clear();
});

function authed(method: 'get' | 'patch', path: string) {
  return (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('DNC enforcement', () => {
  it('PATCH /api/leads/:id to DNC cancels follow-ups and skips pending campaign sends', async () => {
    const { leadId, crId, jobId } = seedLeadWithQueuedSends();

    const res = await authed('patch', `/api/leads/${leadId}`).send({ status: 'DNC' });
    expect(res.status).toBe(200);
    expect(store.leads.get(leadId)?.status).toBe('DNC');
    expect(store.campaignRecipients.get(crId)?.status).toBe('SKIPPED');
    expect(store.followupJobs.get(jobId)?.status).toBe('CANCELLED');
    expect(store.followupJobs.get(jobId)?.cancelReason).toBe('dnc');
  });

  it('PATCH unibox lead-status DNC sets Lead.status=DNC and blocks queued sends', async () => {
    const { leadId, crId, jobId } = seedLeadWithQueuedSends();

    const res = await authed('patch', `/api/unibox/threads/${leadId}/lead-status`).send({ leadStatus: 'DNC' });
    expect(res.status).toBe(200);
    expect(store.leads.get(leadId)?.status).toBe('DNC');
    expect((store.leads.get(leadId)?.intelligence as any)?.threadLeadStatus).toBe('DNC');
    expect(store.campaignRecipients.get(crId)?.status).toBe('SKIPPED');
    expect(store.followupJobs.get(jobId)?.status).toBe('CANCELLED');
  });

  it('unibox INTERESTED maps to canonical Lead.status without touching queued sends', async () => {
    const { leadId, crId, jobId } = seedLeadWithQueuedSends();

    const res = await authed('patch', `/api/unibox/threads/${leadId}/lead-status`).send({ leadStatus: 'INTERESTED' });
    expect(res.status).toBe(200);
    expect(store.leads.get(leadId)?.status).toBe('INTERESTED');
    expect(store.campaignRecipients.get(crId)?.status).toBe('PENDING');
    expect(store.followupJobs.get(jobId)?.status).toBe('SCHEDULED');
  });

  it('unibox LEFT_HANGING never clobbers the pipeline status', async () => {
    const { leadId } = seedLeadWithQueuedSends();

    const res = await authed('patch', `/api/unibox/threads/${leadId}/lead-status`).send({ leadStatus: 'LEFT_HANGING' });
    expect(res.status).toBe(200);
    expect(store.leads.get(leadId)?.status).toBe('CONTACTED');
  });
});
