// FILE: server/src/__tests__/worker.test.ts
//
// Tests for the campaign worker's recipient skip logic (processCampaign).
// The key regression being guarded: a lead that was previously contacted
// (status=CONTACTED) by campaign A must NOT be silently skipped when campaign
// B dispatches it. Only DNC, LOST, bounced, and REPLIED+stopOnReply leads are
// eligible to be skipped; every other status (NEW, CONTACTED, INTERESTED, ...)
// must proceed to the send path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignStatus, FollowupJobStatus, LeadStatus, RecipientStatus } from '@prisma/client';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// We hoist all shared mutable state so vi.mock() factory closures can close
// over it (vi.hoisted runs before any imports).
const { db, mocks } = vi.hoisted(() => {
  const db = {
    campaigns: new Map<string, any>(),
    recipients: new Map<string, any>(),
    leads: new Map<string, any>(),
    followupJobs: new Map<string, any>(),
    users: new Map<string, any>(),
    /** "<userId>:<emailHash>" for every suppressed address. */
    suppressions: new Set<string>(),
    seq: 1,
  };

  const mocks = {
    sendFromMailbox: vi.fn(),
    recordMailboxSend: vi.fn(async () => {}),
    scheduleFollowup: vi.fn(async () => {}),
    pickMailbox: vi.fn(),
  };

  return { db, mocks };
});

vi.mock('../db/prisma.js', () => ({
  prisma: {
    campaignRecipient: {
      count: async ({ where }: any) =>
        [...db.recipients.values()].filter((r) => {
          if (where.campaignId && r.campaignId !== where.campaignId) return false;
          if (where.status?.in) return where.status.in.includes(r.status);
          if (where.status) return r.status === where.status;
          return true;
        }).length,
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = [...db.recipients.values()].filter((r) => {
          if (where.campaignId && r.campaignId !== where.campaignId) return false;
          if (where.status && r.status !== where.status) return false;
          // OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }]
          if (where.OR) {
            const ok = where.OR.some((cond: any) => {
              if ('nextSendAt' in cond && cond.nextSendAt === null) return r.nextSendAt == null;
              if (cond.nextSendAt?.lte) return r.nextSendAt == null || r.nextSendAt <= cond.nextSendAt.lte;
              return false;
            });
            if (!ok) return false;
          }
          return true;
        });
        if (take != null) rows = rows.slice(0, take);
        return rows;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = [...db.recipients.values()].filter((r) =>
          Object.entries(where).every(([k, v]) => r[k] === v),
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      findUnique: async ({ where }: any) => db.recipients.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.recipients.get(where.id) ?? {};
        Object.assign(row, data);
        db.recipients.set(where.id, row);
        return row;
      },
    },
    campaign: {
      count: async () => db.campaigns.size,
      findMany: async ({ where }: any) =>
        [...db.campaigns.values()].filter((c) =>
          !where || Object.entries(where).every(([k, v]) => c[k] === v),
        ),
      updateMany: async ({ where, data }: any) => {
        const rows = [...db.campaigns.values()].filter((c) =>
          Object.entries(where).every(([k, v]) => c[k] === v),
        );
        rows.forEach((c) => Object.assign(c, data));
        return { count: rows.length };
      },
      update: async ({ where, data }: any) => {
        const row = db.campaigns.get(where.id) ?? {};
        Object.assign(row, data);
        db.campaigns.set(where.id, row);
        return row;
      },
    },
    lead: {
      findUnique: async ({ where }: any) => db.leads.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.leads.get(where.id) ?? {};
        Object.assign(row, data);
        db.leads.set(where.id, row);
        return row;
      },
    },
    followupJob: {
      count: async ({ where }: any) =>
        [...db.followupJobs.values()].filter((j) => {
          if (where.campaignId && j.campaignId !== where.campaignId) return false;
          if (where.status && j.status !== where.status) return false;
          return true;
        }).length,
    },
    trackingEvent: {
      create: async ({ data }: any) => ({ id: String(db.seq++), ...data }),
    },
    user: {
      findUnique: async ({ where }: any) => db.users.get(where.id) ?? null,
    },
    suppression: {
      findUnique: async ({ where }: any) => {
        const { userId, emailHash } = where.userId_emailHash;
        return db.suppressions.has(`${userId}:${emailHash}`) ? { id: 'sup' } : null;
      },
      upsert: async ({ where }: any) => {
        const { userId, emailHash } = where.userId_emailHash;
        db.suppressions.add(`${userId}:${emailHash}`);
        return { id: 'sup' };
      },
    },
  },
}));

vi.mock('../campaigns/engine.js', async (importOriginal) => {
  // Re-use the real send-window / budget logic; only stub out mailbox picking
  // (which needs real DB + SMTP credentials) so tests stay offline.
  const real = await importOriginal<typeof import('../campaigns/engine.js')>();
  return {
    ...real,
    pickMailbox: mocks.pickMailbox,
  };
});

vi.mock('../mail/smtpGateway.js', () => ({
  sendFromMailbox: mocks.sendFromMailbox,
}));

vi.mock('../creds/mailboxStore.js', () => ({
  recordMailboxSend: mocks.recordMailboxSend,
  pickRotationMailbox: vi.fn(),
}));

vi.mock('../scheduler/followupScheduler.js', () => ({
  scheduleFollowup: mocks.scheduleFollowup,
}));

vi.mock('../campaigns/spintax.js', () => ({ resolveSpintax: (s: string) => s }));
vi.mock('../campaigns/variables.js', () => ({ renderTemplate: (s: string) => s }));
// NOT mocked. This module used to be stubbed out to a fixed
// `{ text: 'body' }`, which meant no test in this file could ever observe what
// is actually in a sent message — and that is precisely how every campaign
// email went out for months with no postal address in it. It is pure
// string-building with no DB or network, so the real one runs here and the
// assertions below are about real rendered bytes.
import { emailHash } from '../leads/suppression.js';

import { campaignTickOnce } from '../campaigns/worker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TODAY = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const FAKE_MAILBOX = { id: 'mb1', email: 'sender@test.com', provider: 'GMAIL', dailyLimit: 100, sentToday: 0, counterDate: TODAY };

function makeCampaign(overrides: Partial<any> = {}): any {
  const id = `camp${db.seq++}`;
  const row = {
    id,
    userId: 'u1',
    status: CampaignStatus.ACTIVE,
    subject: 'Test subject',
    body: 'Test body',
    autoFollowUps: [],
    stopOnReply: false,
    distributionMethod: 'INDIVIDUAL',
    plainTextMode: false,
    openTracking: false,
    linkTracking: false,
    dailyLimit: null,
    sentToday: 0,
    sentCount: 0,
    bouncedCount: 0,
    counterDate: TODAY,
    followUpPercent: 0,
    sendWindowStart: null,
    sendWindowEnd: null,
    sendDays: null,
    timezone: null,
    sendIntervalMinutes: null,
    nextSendAt: null,
    scheduledAt: null,
    createdAt: new Date('2026-07-11T00:00:00Z'), // after LEGACY_RECIPIENT_CUTOFF
    ...overrides,
  };
  db.campaigns.set(id, row);
  return row;
}

function makeLead(overrides: Partial<any> = {}): any {
  const id = `lead${db.seq++}`;
  const row = { id, userId: 'u1', email: `lead${id}@example.com`, status: LeadStatus.NEW, isBounced: false, ...overrides };
  db.leads.set(id, row);
  return row;
}

function makeRecipient(campaignId: string, leadId: string, overrides: Partial<any> = {}): any {
  const id = `rcpt${db.seq++}`;
  const row = {
    id, campaignId, leadId, userId: 'u1',
    status: RecipientStatus.PENDING,
    attemptCount: 0,
    nextSendAt: null,
    currentStep: 0,
    lastError: null,
    lastSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  db.recipients.set(id, row);
  return row;
}

beforeEach(() => {
  db.campaigns.clear();
  db.recipients.clear();
  db.leads.clear();
  db.followupJobs.clear();
  db.users.clear();
  db.suppressions.clear();
  // Every tenant in these tests has a configured sender identity, because
  // dispatch is fail-closed without one (assertSenderIdentity). Tests that
  // exercise the missing-identity path clear it explicitly.
  db.users.set('u1', {
    id: 'u1',
    businessName: 'Test Agency Ltd',
    businessAddress: '1 Test Street, Testville, TE5 7ER, United Kingdom',
    senderProvenance: null,
  });
  db.seq = 1;
  vi.clearAllMocks();
  mocks.sendFromMailbox.mockResolvedValue('msg-id-1');
  mocks.pickMailbox.mockResolvedValue(FAKE_MAILBOX);
});

// ── Skip-logic tests ──────────────────────────────────────────────────────────

describe('campaign worker recipient skip logic', () => {
  it('sends to a lead in CONTACTED status (second-campaign regression)', async () => {
    // This is the exact scenario that the original bug silently broke:
    //   1. Campaign A sent to lead -> lead is now CONTACTED.
    //   2. Campaign B (same lead as a recipient) should still send.
    // The old guard (status !== NEW) would skip this lead and report the
    // campaign COMPLETED with 0 sends — a silent no-op.
    const lead = makeLead({ status: LeadStatus.CONTACTED });
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).toHaveBeenCalledOnce();
    // Recipient should be COMPLETED (no follow-ups) or IN_SEQUENCE (if any),
    // not SKIPPED.
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).not.toBe(RecipientStatus.SKIPPED);
    expect(updated.status).toBe(RecipientStatus.COMPLETED);
  });

  it('sends to leads in INTERESTED, CALL_BOOKED, and TRIAL statuses', async () => {
    // All three are active pipeline stages — campaigns re-targeting warm leads
    // at different funnel stages must reach them.
    const statuses = [LeadStatus.INTERESTED, LeadStatus.CALL_BOOKED, LeadStatus.TRIAL];
    const campaign = makeCampaign();
    for (const status of statuses) {
      const lead = makeLead({ status });
      makeRecipient(campaign.id, lead.id);
    }

    await campaignTickOnce();

    // All three should have been dispatched, none skipped.
    const allRecipients = [...db.recipients.values()];
    const skipped = allRecipients.filter((r) => r.status === RecipientStatus.SKIPPED);
    expect(skipped).toHaveLength(0);
    expect(mocks.sendFromMailbox).toHaveBeenCalledTimes(3);
  });

  it('skips a DNC lead unconditionally (hard compliance stop)', async () => {
    const lead = makeLead({ status: LeadStatus.DNC });
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).toBe(RecipientStatus.SKIPPED);
    expect(updated.lastError).toContain('DNC');
  });

  it('skips a LOST lead unconditionally', async () => {
    const lead = makeLead({ status: LeadStatus.LOST });
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).toBe(RecipientStatus.SKIPPED);
    expect(updated.lastError).toContain('LOST');
  });

  it('skips a REPLIED lead when stopOnReply is true', async () => {
    const lead = makeLead({ status: LeadStatus.REPLIED });
    const campaign = makeCampaign({ stopOnReply: true });
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).toBe(RecipientStatus.SKIPPED);
    expect(updated.lastError).toContain('stopOnReply');
  });

  it('sends to a REPLIED lead when stopOnReply is false', async () => {
    // A campaign that doesn't gate on replies (e.g. a newsletter blast)
    // should still reach leads who replied to an earlier campaign.
    const lead = makeLead({ status: LeadStatus.REPLIED });
    const campaign = makeCampaign({ stopOnReply: false });
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).toHaveBeenCalledOnce();
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).not.toBe(RecipientStatus.SKIPPED);
  });

  it('skips a bounced lead even when status is otherwise sendable', async () => {
    // isBounced is checked before the status guards; this test confirms
    // that the existing bounce check (line ~343) is preserved by the fix.
    const lead = makeLead({ status: LeadStatus.NEW, isBounced: true });
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).toBe(RecipientStatus.SKIPPED);
    expect(updated.lastError).toContain('bounced');
  });
});

describe('a delivered message is never re-sent', () => {
  // The PENDING -> SENDING claim protects against concurrent workers and
  // against a crash BEFORE the send, but the catch deliberately releases the
  // claim back to PENDING for a retry — and a failure AFTER the SMTP handoff
  // (follow-up scheduling, the status write, a counter update) takes exactly
  // that path. The next tick then dispatched the same email again: a real
  // duplicate to a prospect, which is reputational damage, not just noise.
  it('does not retry when post-send bookkeeping fails', async () => {
    const lead = makeLead({ status: LeadStatus.NEW });
    const campaign = makeCampaign({
      autoFollowUps: [{ delay: 1, unit: 'days', content: 'follow up' }],
    });
    const recipient = makeRecipient(campaign.id, lead.id);

    // Send succeeds; the very next step (scheduling follow-ups) blows up.
    mocks.scheduleFollowup.mockRejectedValueOnce(new Error('DB connection lost'));

    await campaignTickOnce();
    expect(mocks.sendFromMailbox).toHaveBeenCalledOnce();

    // Must be closed out, NOT released back to PENDING for a retry.
    const afterFirst = db.recipients.get(recipient.id);
    expect(afterFirst.status).not.toBe(RecipientStatus.PENDING);
    expect(afterFirst.status).toBe(RecipientStatus.COMPLETED);
    expect(afterFirst.lastError).toContain('post-send');

    // The decisive assertion: a second tick must not send again.
    await campaignTickOnce();
    expect(mocks.sendFromMailbox).toHaveBeenCalledOnce();
  });
});

// ── Compliance gating ────────────────────────────────────────────────────────

describe('commercial sends are fail-closed without a sender identity', () => {
  it('does not send at all when the tenant has no business name / postal address', async () => {
    // CAN-SPAM requires a physical postal address in every commercial message.
    // The alternative to blocking here is sending without one, which is what
    // this system did for its entire life — silently, per message.
    db.users.set('u1', { id: 'u1', businessName: null, businessAddress: null, senderProvenance: null });
    const lead = makeLead();
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    // The recipient must be RELEASED, not failed: this is an operator problem,
    // so no attempt is burned and the audience survives intact for when the
    // address is filled in.
    const updated = db.recipients.get(recipient.id);
    expect(updated.status).toBe(RecipientStatus.PENDING);
    expect(updated.attemptCount ?? 0).toBe(0);
    expect(db.campaigns.get(campaign.id).pausedReason).toBe('MISSING_SENDER_IDENTITY');
  });

  it('treats a whitespace-only address as missing rather than sending a blank footer', async () => {
    db.users.set('u1', { id: 'u1', businessName: '  ', businessAddress: '   ', senderProvenance: null });
    makeRecipient(makeCampaign().id, makeLead().id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
  });

  it('sends the postal address in the actual message body', async () => {
    makeRecipient(makeCampaign().id, makeLead().id);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).toHaveBeenCalledOnce();
    const [, payload] = mocks.sendFromMailbox.mock.calls[0];
    expect(payload.text).toContain('1 Test Street, Testville, TE5 7ER, United Kingdom');
    expect(payload.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/t\/u\/.+>$/);
  });
});

describe('suppression outlives the lead row', () => {
  it('skips a recipient whose address is suppressed even though the lead looks fresh', async () => {
    // The exact re-import scenario: someone unsubscribed, the lead was later
    // deleted, and the scraper found the same channel again — so the Lead row
    // is brand new, status NEW, with no memory of the opt-out. Only the
    // suppression list stands between that and mailing them again.
    const lead = makeLead({ status: LeadStatus.NEW });
    const campaign = makeCampaign();
    const recipient = makeRecipient(campaign.id, lead.id);
    db.suppressions.add(`u1:${emailHash(lead.email)}`);

    await campaignTickOnce();

    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
    expect(db.recipients.get(recipient.id).status).toBe(RecipientStatus.SKIPPED);
  });

  it('records a hard bounce on the suppression list, not just on the lead', async () => {
    const lead = makeLead();
    makeRecipient(makeCampaign().id, lead.id);
    const hardBounce: any = new Error('550 5.1.1 No such user');
    hardBounce.responseCode = 550;
    mocks.sendFromMailbox.mockRejectedValueOnce(hardBounce);

    await campaignTickOnce();

    // isBounced dies with the row; the hash does not.
    expect(db.leads.get(lead.id).isBounced).toBe(true);
    expect(db.suppressions.has(`u1:${emailHash(lead.email)}`)).toBe(true);
  });
});
