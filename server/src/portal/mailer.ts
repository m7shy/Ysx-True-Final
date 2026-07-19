import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { sendFromMailbox } from '../mail/smtpGateway.js';

/**
 * Portal transactional email (invites, magic links, invoice notices), sent
 * from the agency owner's first healthy connected mailbox — no separate
 * transactional-email provider. Fails LOUD (throws) when the tenant has no
 * active mailbox: an invite that silently never arrives is worse than an
 * error the admin can act on.
 */
export async function sendPortalEmail(
  userId: string,
  input: { to: string; subject: string; text: string; html?: string }
): Promise<void> {
  const mailbox = await prisma.mailbox.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!mailbox) {
    throw Object.assign(
      new Error('No active connected mailbox — connect one in Integrations before inviting clients'),
      { code: 'NO_MAILBOX', status: 409 }
    );
  }

  await sendFromMailbox(mailbox, {
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  logger.info({ userId, to: input.to, subject: input.subject }, 'Portal email sent');
}

/** Absolute base URL for portal links in emails (e.g. https://ysxvisuals.online). */
export function portalBaseUrl(): string {
  const origin = (config.WEB_ORIGIN || 'http://localhost:3001').replace(/\/+$/, '');
  return `${origin}/portal`;
}
