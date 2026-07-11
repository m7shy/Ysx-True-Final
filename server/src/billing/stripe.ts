import Stripe from 'stripe';
import { SubscriptionTier } from '@prisma/client';

import { config } from '../config.js';

/**
 * Stripe SDK client singleton. Constructed lazily so mail-only runs and the
 * vitest suite can import the billing module without a STRIPE_SECRET_KEY;
 * anything that actually talks to Stripe fails fast with a clear error.
 */
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!config.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  client ??= new Stripe(config.STRIPE_SECRET_KEY);
  return client;
}

export function isBillingConfigured(): boolean {
  return Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET);
}

/**
 * Map a Stripe price ID (from the subscription's first line item) to the
 * tenant tier it purchases. Unknown/missing price IDs resolve to FREE so a
 * misconfigured price can never grant a paid tier.
 */
export function tierForPrice(priceId: string | undefined): SubscriptionTier {
  if (priceId && priceId === config.STRIPE_PRICE_AGENCY) return SubscriptionTier.AGENCY;
  if (priceId && priceId === config.STRIPE_PRICE_PRO) return SubscriptionTier.PRO;
  return SubscriptionTier.FREE;
}
