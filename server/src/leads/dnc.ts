// FILE: server/src/leads/dnc.ts

import { RecipientStatus, type Lead } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { cancelScheduledFollowupsForUserRecipient } from '../scheduler/followupScheduler.js';

/**
 * Enforce a lead's DNC (do-not-contact) status across every automated send
 * path, so a lead marked DNC is never emailed again:
 *
 * - cancels every still-scheduled follow-up job the tenant has queued for
 *   this email, across all campaigns;
 * - skips every PENDING campaign-recipient row for this lead, so campaign
 *   dispatch never picks them up (the worker's non-NEW status guard would
 *   also catch them, but this makes the block immediate and visible in the
 *   recipient list).
 *
 * Call this whenever Lead.status transitions to DNC (leads PATCH route,
 * unibox lead-status route). Idempotent.
 */
export async function enforceDnc(userId: string, lead: Pick<Lead, 'id' | 'email'>): Promise<void> {
  const cancelledCampaigns = await cancelScheduledFollowupsForUserRecipient(userId, lead.email, 'dnc');

  const skipped = await prisma.campaignRecipient.updateMany({
    where: { userId, leadId: lead.id, status: RecipientStatus.PENDING },
    data: { status: RecipientStatus.SKIPPED, lastError: 'Lead marked DNC' },
  });

  logger.info(
    { userId, leadId: lead.id, cancelledCampaigns: cancelledCampaigns.length, skippedRecipients: skipped.count },
    'Lead marked DNC; automated sends blocked',
  );
}
