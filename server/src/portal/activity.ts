import type { ActivityType } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

/**
 * Append a project activity row — the portal's activity feed and "last
 * updated" trust signal. summary is pre-rendered here so the feed needs no
 * joins. Never throws: a failed feed write must not fail the primary mutation.
 */
export async function logActivity(projectId: string, type: ActivityType, summary: string): Promise<void> {
  try {
    await prisma.activityEvent.create({ data: { projectId, type, summary } });
  } catch (err) {
    logger.error({ err, projectId, type }, 'Failed to write activity event');
  }
}
