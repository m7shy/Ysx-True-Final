// FILE: server/src/__tests__/manualSendCompliance.test.ts
//
// The two MANUAL send paths must carry the same legal footer as the campaign
// path, and must fail closed without a sender identity.
//
// complianceFooter(), unsubscribeHeaders() and assertSenderIdentity() had
// exactly two call sites each, all on the campaign path. The Dashboard
// follow-up composer (POST /api/mail/send) and the Unibox reply sent commercial
// email with no postal address, no visible unsubscribe link and no RFC 8058
// header — while the campaign path refuses to send at all without them.
//
// The reason they differed was structural, not principled: the opt-out URL was
// derived from a CampaignRecipient row via unsubscribeUrlForRecipient(), and a
// one-off email has no such row. unsubscribeUrlForAddress() signs
// (tenant, address) instead, so no row and no migration are needed.
//
// These assert the WIRING — that the bytes handed to SMTP actually contain the
// footer — not the rule. A unit test on complianceFooter() would have passed
// happily for the entire life of this bug, which is the lesson recorded in
// .plans/known-failures.md as "a unit test on a pure function proves the rule,
// not its application".

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const { store, sent } = vi.hoisted(() => ({
  store: { users: new Map<string, any>(), leads: new Map<string, any>(), suppressed: new Set<string>() },
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
    lead: {
      findFirst: async ({ where }: any) => {
        const email = where?.email?.equals ?? where?.email;
        const row = [...store.leads.values()].find(
          (l) => l.userId === where.userId && String(l.email).toLowerCase() === String(email).toLowerCase(),
        );
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: any) => Object.assign(store.leads.get(where.id), data),
    },
    suppression: {
      findUnique: async ({ where }: any) =>
        store.suppressed.has(where.userId_emailHash.emailHash) ? { id: 's' } : null,
      upsert: async ({ where }: any) => {
        store.suppressed.add(where.userId_emailHash.emailHash);
        return { id: 's' };
      },
    },
  }),
}));

// Capture what would go over SMTP, and never actually connect.
vi.mock('../mail/smtpGateway.js', () => ({
  sendSmtpMail: async (_userId: string, _provider: string, input: any) => {
    sent.push(input);
    return '<sent-id>';
  },
  sendFromMailbox: async (_mailbox: any, input: any) => {
    sent.push(input);
    return '<sent-id>';
  },
}));

const identity = {
  businessName: 'YSX Visuals',
  businessAddress: '12 Example Street\nLondon N1 1AA',
  senderProvenance: null,
};
const senderIdentity = vi.hoisted(() => ({ missing: false }));

vi.mock('../campaigns/senderIdentity.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertSenderIdentity: async () => {
      if (senderIdentity.missing) throw new actual.MissingSenderIdentityError();
      return identity;
    },
  };
});

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';
import {
  signAddressUnsubscribeToken,
  verifyAddressUnsubscribeToken,
  verifyTrackingToken,
  signTrackingToken,
} from '../campaigns/trackingToken.js';

const USER_ID = 'u1';
let token: string;

beforeAll(() => {
  store.users.set(USER_ID, { id: USER_ID, status: 'ACTIVE', tokenVersion: 0 });
  token = signAccessToken({ userId: USER_ID, email: 'op@example.com', tokenVersion: 0 });
});

beforeEach(() => {
  sent.length = 0;
  store.leads.clear();
  store.suppressed.clear();
  senderIdentity.missing = false;
});

const post = (path: string) =>
  (request(app) as any).post(path).set('Authorization', `Bearer ${token}`);

describe('address-scoped unsubscribe token', () => {
  it('round-trips the tenant and address', () => {
    const t = signAddressUnsubscribeToken(USER_ID, 'Prospect@Example.COM');
    // Normalised on the way in, so the token matches the suppression key.
    expect(verifyAddressUnsubscribeToken(t)).toEqual({ userId: USER_ID, email: 'prospect@example.com' });
  });

  it('rejects a tampered token', () => {
    const t = signAddressUnsubscribeToken(USER_ID, 'prospect@example.com');
    expect(verifyAddressUnsubscribeToken(`${t}x`)).toBeNull();
    expect(verifyAddressUnsubscribeToken(t.replace(/^[^.]+/, 'AAAA'))).toBeNull();
  });

  it('is bound to the tenant, so it cannot be replayed at another agency', () => {
    const t = signAddressUnsubscribeToken(USER_ID, 'prospect@example.com');
    const other = verifyAddressUnsubscribeToken(t);
    expect(other?.userId).toBe(USER_ID);
    // A token minted for a different tenant over the same address differs.
    expect(signAddressUnsubscribeToken('u2', 'prospect@example.com')).not.toBe(t);
  });

  it('is domain-separated from the campaign recipient token', () => {
    // The two families share one public route, so a token from one must never
    // verify as the other — otherwise a recipient id could be read as an
    // address, or vice versa.
    const addr = signAddressUnsubscribeToken(USER_ID, 'prospect@example.com');
    const recip = signTrackingToken('recipient-id-1');
    expect(verifyTrackingToken(addr)).toBeNull();
    expect(verifyAddressUnsubscribeToken(recip)).toBeNull();
  });
});

describe('POST /api/mail/send — compliance', () => {
  const body = { to: 'prospect@example.com', subject: 'Following up', body: 'Quick thought for you.' };

  it('appends the postal address and a working unsubscribe link', async () => {
    const res = await post('/api/mail/send').send(body);

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('12 Example Street');
    expect(sent[0].text).toContain('YSX Visuals');
    expect(sent[0].text).toMatch(/Unsubscribe: \S+\/t\/u\/\S+/);
  });

  it('sets the RFC 8058 one-click headers', async () => {
    await post('/api/mail/send').send(body);

    expect(sent[0].headers['List-Unsubscribe']).toMatch(/^<.*\/t\/u\/.*>$/);
    expect(sent[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('mints a link that actually opts THIS address out', async () => {
    // The whole point: the link in the footer must resolve back to the
    // recipient. A footer with an unverifiable link is decoration.
    await post('/api/mail/send').send(body);

    const url: string = sent[0].headers['List-Unsubscribe'].slice(1, -1);
    const linkToken = url.split('/t/u/')[1];

    expect(verifyAddressUnsubscribeToken(linkToken)).toEqual({
      userId: USER_ID,
      email: 'prospect@example.com',
    });

    // And following it suppresses the address, which the send guard then reads.
    const unsub = await request(app).post(`/t/u/${linkToken}`);
    expect(unsub.status).toBe(200);

    const second = await post('/api/mail/send').send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SUPPRESSED');
    expect(sent).toHaveLength(1); // no second message
  });

  it('fails closed with no sender identity, exactly like the campaign path', async () => {
    senderIdentity.missing = true;

    const res = await post('/api/mail/send').send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MISSING_SENDER_IDENTITY');
    expect(sent).toHaveLength(0);
  });

  it('refuses a multi-recipient send rather than sending a wrong opt-out link', async () => {
    // One message cannot carry a correct per-recipient unsubscribe link, and
    // the wrong link would opt out somebody else.
    const res = await post('/api/mail/send').send({ ...body, to: 'a@example.com, b@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MULTIPLE_RECIPIENTS');
    expect(sent).toHaveLength(0);
  });
});
