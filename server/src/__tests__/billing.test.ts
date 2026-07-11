import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { prismaMock, WEBHOOK_SECRET } = vi.hoisted(() => {
  // Set BEFORE any module import so config.ts picks these up.
  const WEBHOOK_SECRET = 'whsec_test_secret_for_billing_tests';
  process.env.STRIPE_SECRET_KEY = 'sk_test_billing_tests';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = 'price_pro_test';
  process.env.STRIPE_PRICE_AGENCY = 'price_agency_test';

  return {
    WEBHOOK_SECRET,
    prismaMock: {
      user: { findUnique: vi.fn(), update: vi.fn() },
      usageRecord: { findUnique: vi.fn() },
      $executeRaw: vi.fn(),
    },
  };
});

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));

import request from 'supertest';
import { app } from '../index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function subscriptionEvent(type: string, sub: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type,
    data: { object: sub },
  });
}

function signedHeader(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

const baseSubscription = {
  id: 'sub_test_1',
  object: 'subscription',
  status: 'active',
  customer: 'cus_test_1',
  metadata: { userId: 'u1' },
  items: {
    data: [
      {
        price: { id: 'price_pro_test' },
        current_period_start: 1780000000,
        current_period_end: 1782592000,
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
  prismaMock.user.update.mockResolvedValue({ id: 'u1' });
});

// ── Webhook authentication ────────────────────────────────────────────────────

describe('POST /api/billing/webhook', () => {
  it('rejects a payload with no Stripe-Signature header', async () => {
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(subscriptionEvent('customer.subscription.created', baseSubscription));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SIGNATURE_REQUIRED');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a payload signed with the wrong secret', async () => {
    const payload = subscriptionEvent('customer.subscription.created', baseSubscription);
    const badHeader = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_wrong_secret',
    });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', badHeader)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a tampered payload even with a previously valid signature', async () => {
    const original = subscriptionEvent('customer.subscription.created', baseSubscription);
    const header = signedHeader(original);
    const tampered = original.replace('price_pro_test', 'price_agency_test');

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(tampered);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('flips the tenant tier on a correctly signed subscription.created', async () => {
    const payload = subscriptionEvent('customer.subscription.created', baseSubscription);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signedHeader(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data.tier).toBe('PRO');
    expect(update.data.status).toBe('ACTIVE');
    expect(update.data.stripeSubscriptionId).toBe('sub_test_1');
    expect(update.data.currentPeriodStart).toEqual(new Date(1780000000 * 1000));
  });

  it('drops a lapsed (past_due) subscription to FREE/UNPAID', async () => {
    const payload = subscriptionEvent('customer.subscription.updated', {
      ...baseSubscription,
      status: 'past_due',
    });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signedHeader(payload))
      .send(payload);

    expect(res.status).toBe(200);
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.data.tier).toBe('FREE');
    expect(update.data.status).toBe('UNPAID');
  });

  it('downgrades and gates the tenant on subscription.deleted', async () => {
    const payload = subscriptionEvent('customer.subscription.deleted', baseSubscription);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signedHeader(payload))
      .send(payload);

    expect(res.status).toBe(200);
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.data.tier).toBe('FREE');
    expect(update.data.status).toBe('UNPAID');
    expect(update.data.stripeSubscriptionId).toBeNull();
  });
});

// ── Subscription mutation gate ────────────────────────────────────────────────

describe('requireActiveTenant billing gate', () => {
  it('throws ACCESS_DENIED for mutations from an UNPAID tenant', async () => {
    const { requireActiveTenant } = await import('../auth/tenantGate.js');
    prismaMock.user.findUnique.mockResolvedValue({ status: 'UNPAID' });

    const req = { method: 'POST', auth: { userId: 'u1' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();

    await requireActiveTenant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_DENIED' }));
  });

  it('still allows reads from an UNPAID tenant', async () => {
    const { requireActiveTenant } = await import('../auth/tenantGate.js');
    const req = { method: 'GET', auth: { userId: 'u1' } } as any;
    const next = vi.fn();

    await requireActiveTenant(req, {} as any, next);

    expect(next).toHaveBeenCalled();
  });
});
