import type { Request, Response, NextFunction } from 'express';
import { AccountStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

/**
 * Billing/tenancy mutation gate. Mounted AFTER requireAuth on every
 * tenant-scoped router.
 *
 * Reads are always allowed (a lapsed customer can still see their data —
 * that's both kinder and what Stripe recovery flows assume), but any
 * mutation (POST/PUT/PATCH/DELETE) from a tenant whose account status is
 * UNPAID or INACTIVE is rejected:
 *   - UNPAID   → 403 ACCESS_DENIED (subscription expired/payment bounced —
 *                flipped by the Stripe webhooks in src/billing/webhook.ts)
 *   - INACTIVE → 403 ACCESS_DENIED (account disabled)
 *
 * The status is read from the DB on every mutation rather than baked into the
 * JWT so that flipping User.status takes effect immediately, not after token
 * expiry.
 *
 * Same query also enforces tokenVersion: an access token minted before a
 * logout-everywhere / password reset (User.tokenVersion bumped) is rejected
 * for mutations immediately, rather than staying valid until it naturally
 * expires (access tokens are short-lived, so reads lag at most ~15 min —
 * acceptable; mutations do not lag at all). Tokens issued before this claim
 * existed carry no `ver` and are not checked, so this cannot lock out an
 * already-open session.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function requireActiveTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const userId = req.auth?.userId;
  if (!userId) {
    // requireAuth should have run first; treat as unauthenticated.
    res.status(401).json({ code: 'AUTH', message: 'Authentication required' });
    return;
  }

  let status: AccountStatus | null;
  let tokenVersion: number | null = null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, tokenVersion: true },
    });
    status = user?.status ?? null;
    tokenVersion = user?.tokenVersion ?? null;
  } catch (err) {
    logger.error({ err, userId }, 'Tenant status lookup failed');
    res.status(503).json({ code: 'DB_UNAVAILABLE', message: 'Could not verify account status' });
    return;
  }

  if (status === null) {
    // Token is valid but the user row is gone (deleted account).
    res.status(401).json({ code: 'AUTH', message: 'Account no longer exists' });
    return;
  }

  const tokenVer = req.auth?.tokenVersion;
  if (tokenVer !== undefined && tokenVer !== tokenVersion) {
    res.status(401).json({ code: 'AUTH', message: 'Session has been revoked. Please log in again.' });
    return;
  }

  if (status === AccountStatus.UNPAID) {
    res.status(403).json({
      code: 'ACCESS_DENIED',
      message: 'Your subscription has expired or a payment bounced. Renew your plan to make changes.',
    });
    return;
  }

  if (status === AccountStatus.INACTIVE) {
    res.status(403).json({
      code: 'ACCESS_DENIED',
      message: 'This account is inactive. Contact support to reactivate it.',
    });
    return;
  }

  next();
}
