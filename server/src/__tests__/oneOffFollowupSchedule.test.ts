// FILE: server/src/__tests__/oneOffFollowupSchedule.test.ts
//
// A follow-up scheduled from the Dashboard composer belongs to NO campaign, and
// must still queue, send on time, and carry the legal footer.
//
// POST /api/followups/schedule existed and worked for months, but demanded a
// non-empty `campaignId` and `originalMessageId`. The only UI that offers
// scheduling — the follow-up composer — has neither: a one-off email has no
// campaign, and an IMAP message frequently has no Message-ID (mailGateway
// derives it from `envelope?.messageId`, which is not guaranteed). So the
// feature was unreachable, and DashboardView quietly sent immediately instead
// while reporting "Follow-up scheduled successfully."
//
// The trap this guards against: the obvious way to satisfy the old schema is to
// invent a campaignId. That is silently fatal — sendFollowupJob looks the id up
// and calls cancelFollowup(..., 'campaign_deleted') when it does not resolve,
// so the follow-up would be accepted, displayed as scheduled, and then dropped
// at send time with nothing surfaced.
//
// Mutation coverage, verified by performing each mutation:
//  - restoring `campaignId: z.string().min(1)` fails "accepts a schedule with
//    no campaign";
//  - restoring the `throw new Error("campaignId is required")` in
//    followupScheduler fails the same test;
//  - deleting the else-branch footer in sendFollowupJob fails "stamps the
//    compliance footer on a campaign-less follow-up".

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const { store, sent } = vi.hoisted(() => ({
  store: { users: new Map<string, any>(), jobs: new Map<string, any>(), seq: 1 },
  sent: [] as any[],
}));

function extendable<T extends Record<string, Record<string, (...a: any[]) => any>>>(base: T): T {
  const withExtends: any = { ...base };
  withExtends.$extends = () => extendable(base);
  return withExtends;
}

vi.mock('../db/prisma.js', () => ({
  prisma: extendable({
    user: { findUnique: async ({ where }: any) => store.users.get(where.id) ?? null },
    lead: { findFirst: async () => null },
    suppression: { findUnique: async () => null },
    followupJob: {
      create: async ({ data }: any) => {
        // createdAt/updatedAt are @default(now()) in the schema, so real Prisma
        // fills them; the DTO calls .toISOString() on them.
        const row = { id: `fj${store.seq++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        store.jobs.set(row.id, row);
        return row;
      },
      findMany: async () => [...store.jobs.values()],
      updateMany: async () => ({ count: 0 }),
      update: async ({ where, data }: any) => Object.assign(store.jobs.get(where.id), data),
    },
    campaign: { findUnique: async () => null },
  }),
}));

// Spread the real module: it also exports parseProvider and friends, which the
// routes and sendFollowupJob use.
vi.mock('../mail/smtpGateway.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    sendSmtpMail: async (_u: string, _p: string, input: any) => {
      sent.push(input);
      return '<sent-id>';
    },
    sendFromMailbox: async (_m: any, input: any) => {
      sent.push(input);
      return '<sent-id>';
    },
  };
});

const identity = {
  businessName: 'YSX Visuals',
  businessAddress: '12 Example Street\nLondon N1 1AA',
  senderProvenance: null,
};
vi.mock('../campaigns/senderIdentity.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, assertSenderIdentity: async () => identity };
});

// The reply gate reaches for IMAP; keep it deterministic and offline.
vi.mock('../mail/replyCheck.js', () => ({
  checkRecipientReply: async () => 'no_reply',
}));

import { app, sendFollowupJob } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';
import { verifyAddressUnsubscribeToken } from '../campaigns/trackingToken.js';

const USER_ID = 'u1';
let token: string;

beforeAll(() => {
  store.users.set(USER_ID, { id: USER_ID, status: 'ACTIVE', tokenVersion: 0 });
  token = signAccessToken({ userId: USER_ID, email: 'op@example.com', tokenVersion: 0 });
});

beforeEach(() => {
  store.jobs.clear();
  sent.length = 0;
});

const schedulePayload = {
  provider: 'gmail',
  to: 'prospect@example.com',
  subject: 'Re: Quick question',
  body: 'Circling back on this.',
  scheduledAt: new Date('2026-08-10T09:00:00Z').toISOString(),
  recipientEmail: 'prospect@example.com',
  initialSentAt: new Date('2026-08-05T09:00:00Z').toISOString(),
  skipIfReplied: true,
};

describe('one-off follow-up scheduling', () => {
  it('accepts a schedule with no campaign and no Message-ID', async () => {
    const res = await request(app)
      .post('/api/followups/schedule')
      .set('Authorization', `Bearer ${token}`)
      .send(schedulePayload);

    expect(res.status).toBe(200);
    expect(res.body.job).toBeTruthy();

    const row = [...store.jobs.values()][0];
    // Stored as null, NOT as an invented id — a non-resolving campaignId is
    // cancelled as `campaign_deleted` at send time.
    expect(row.campaignId ?? null).toBeNull();
    expect(row.recipientEmail).toBe('prospect@example.com');
  });

  it('still requires the fields reply-gating genuinely needs', async () => {
    const res = await request(app)
      .post('/api/followups/schedule')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...schedulePayload, recipientEmail: undefined, to: undefined });

    expect(res.status).toBe(400);
  });

  it('stamps the compliance footer on a campaign-less follow-up', async () => {
    // The send path, not the schedule path: a queued one-off must carry the
    // same postal address and opt-out link as a campaign follow-up, or
    // scheduling would have re-opened the hole F14 closed.
    await sendFollowupJob({
      id: 'job-1',
      userId: USER_ID,
      provider: 'gmail',
      to: 'prospect@example.com',
      recipientEmail: 'prospect@example.com',
      subject: 'Re: Quick question',
      body: 'Circling back on this.',
      initialSentAt: schedulePayload.initialSentAt,
      skipIfReplied: true,
      campaignId: null,
      leadId: null,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('12 Example Street');
    expect(sent[0].text).toContain('YSX Visuals');
    expect(sent[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // And the link resolves back to this recipient.
    const url: string = sent[0].headers['List-Unsubscribe'].slice(1, -1);
    expect(verifyAddressUnsubscribeToken(url.split('/t/u/')[1])).toEqual({
      userId: USER_ID,
      email: 'prospect@example.com',
    });
  });
});
