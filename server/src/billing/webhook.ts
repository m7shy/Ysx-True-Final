import { Router, type Request, type Response } from 'express';
import express from 'express';
import type Stripe from 'stripe';
import { AccountStatus, SubscriptionTier, type Prisma } from '@prisma/client';

import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { getStripe, isBillingConfigured, tierForPrice } from './stripe.js';
import { invalidateUsageAnchor } from './usage.js';

/**
 * Stripe webhook endpoint. Mounted at /api/billing/webhook BEFORE the global
 * express.json() middleware: signature verification requires the exact raw
 * request bytes, so this router carries its own express.raw() body parser.
 *
 * Every request is authenticated by verifying the `Stripe-Signature` header
 * against STRIPE_WEBHOOK_SECRET via stripe.webhooks.constructEvent (HMAC-SHA256
 * with replay-window timestamp checking). Unsigned, mis-signed, or replayed
 * payloads are rejected with 400 and never touch the database.
 */

const router = Router();

// Stripe subscription statuses that leave the tenant able to mutate data.
const HEALTHY_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);

function subscriptionCustomerId(sub: Stripe.Subscription): string | null {
  if (typeof sub.customer === 'string') return sub.customer;
  return sub.customer?.id ?? null;
}

/**
 * Resolve the tenant a subscription event belongs to. Order of trust:
 * checkout metadata (set when the subscription is created), then the stored
 * subscription ID, then the stored customer ID.
 */
async function resolveTenantId(sub: Stripe.Subscription): Promise<string | null> {
  const metaUserId = sub.metadata?.userId;
  if (metaUserId) {
    const user = await prisma.user.findUnique({ where: { id: metaUserId }, select: { id: true } });
    if (user) return user.id;
  }

  const bySubscription = await prisma.user.findUnique({
    where: { stripeSubscriptionId: sub.id },
    select: { id: true },
  });
  if (bySubscription) return bySubscription.id;

  const customerId = subscriptionCustomerId(sub);
  if (customerId) {
    const byCustomer = await prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }

  return null;
}

function periodFromSubscription(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  // Billing-cycle timestamps live on the subscription items (Basil API).
  const item = sub.items?.data?.[0];
  return {
    start: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
    end: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
  };
}

/** Apply a created/updated subscription: flip tier + gate status in one atomic UPDATE. */
async function applySubscriptionState(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveTenantId(sub);
  if (!userId) {
    logger.warn(
      { subscriptionId: sub.id, customerId: subscriptionCustomerId(sub) },
      'Stripe subscription event does not match any tenant',
    );
    return;
  }

  const healthy = HEALTHY_STATUSES.has(sub.status);
  const period = periodFromSubscription(sub);

  const data: Prisma.UserUpdateInput = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: subscriptionCustomerId(sub),
    tier: healthy ? tierForPrice(sub.items?.data?.[0]?.price?.id) : SubscriptionTier.FREE,
    // A lapsed/bounced subscription flips the mutation gate; INACTIVE is a
    // manual/admin state and is never overwritten by billing events.
    status: healthy ? AccountStatus.ACTIVE : AccountStatus.UNPAID,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
  };

  await prisma.user.update({ where: { id: userId }, data });
  invalidateUsageAnchor(userId);

  logger.info(
    { userId, subscriptionId: sub.id, stripeStatus: sub.status, tier: data.tier, status: data.status },
    'Tenant tier updated from Stripe subscription event',
  );
}

/** Apply a deleted subscription: drop to FREE and close the mutation gate. */
async function applySubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveTenantId(sub);
  if (!userId) {
    logger.warn({ subscriptionId: sub.id }, 'Stripe subscription.deleted does not match any tenant');
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: null,
      tier: SubscriptionTier.FREE,
      status: AccountStatus.UNPAID,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
  });
  invalidateUsageAnchor(userId);

  logger.info({ userId, subscriptionId: sub.id }, 'Tenant downgraded after subscription deletion');
}

router.post(
  '/',
  // Raw bytes only — constructEvent hashes the exact payload Stripe signed.
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    if (!isBillingConfigured()) {
      logger.error('Stripe webhook received but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not configured');
      res.status(503).json({ code: 'BILLING_NOT_CONFIGURED', message: 'Billing is not configured' });
      return;
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).json({ code: 'SIGNATURE_REQUIRED', message: 'Missing Stripe-Signature header' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body as Buffer,
        signature,
        config.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (err) {
      logger.warn({ err }, 'Rejected Stripe webhook with invalid signature');
      res.status(400).json({ code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' });
      return;
    }

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await applySubscriptionState(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await applySubscriptionDeleted(event.data.object);
          break;
        default:
          // Acknowledge everything else so Stripe does not retry event types
          // this endpoint deliberately ignores.
          break;
      }
    } catch (err) {
      logger.error({ err, eventType: event.type, eventId: event.id }, 'Stripe webhook handler failed');
      // Non-2xx makes Stripe retry with backoff — correct for transient DB errors.
      res.status(500).json({ code: 'WEBHOOK_HANDLER_FAILED', message: 'Event processing failed' });
      return;
    }

    res.json({ received: true });
  },
);

export default router;
