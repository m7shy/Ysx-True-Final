import { Router, type Request, type Response } from 'express';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { getCurrentCycleUsage } from './usage.js';

/**
 * Authenticated tenant-facing billing reads. Mounted behind requireAuth (but
 * NOT behind the mutation gate — a lapsed tenant must still be able to see
 * why they are blocked and what their usage is).
 */
const router = Router();

router.get('/usage', async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ code: 'AUTH', message: 'Authentication required' });
    return;
  }

  try {
    const [user, usage] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { tier: true, status: true, currentPeriodStart: true, currentPeriodEnd: true },
      }),
      getCurrentCycleUsage(userId),
    ]);

    if (!user) {
      res.status(401).json({ code: 'AUTH', message: 'Account no longer exists' });
      return;
    }

    res.json({
      tier: user.tier,
      status: user.status,
      periodStart: usage.periodStart.toISOString(),
      periodEnd: user.currentPeriodEnd?.toISOString() ?? null,
      emailsSent: usage.emailsSent,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Billing usage lookup failed');
    res.status(503).json({ code: 'DB_UNAVAILABLE', message: 'Could not load usage' });
  }
});

export default router;
