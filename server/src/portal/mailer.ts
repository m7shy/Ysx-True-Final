import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { sendFromMailbox } from '../mail/smtpGateway.js';
import { sendMail } from '../mail/smtpClient.js';

/**
 * Portal transactional email (invites, magic links, invoice notices). Primary
 * path: the agency owner's first healthy connected mailbox. Fallback path:
 * plain SMTP via PORTAL_SMTP_* (e.g. Brevo free tier / Gmail app password) —
 * the OAuth mailbox has broken twice in production and a client invite that
 * never arrives is a lost client. Still fails LOUD (throws) when neither
 * path can deliver.
 */

export function smtpFallbackConfigured(): boolean {
  return Boolean(config.PORTAL_SMTP_HOST && config.PORTAL_SMTP_USER && config.PORTAL_SMTP_PASS);
}

/** Send via the PORTAL_SMTP_* fallback transport. Throws if unconfigured. */
export async function sendViaFallbackSmtp(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!smtpFallbackConfigured()) {
    throw Object.assign(new Error('PORTAL_SMTP_* fallback is not configured'), { code: 'NO_FALLBACK' });
  }
  await sendMail({
    host: config.PORTAL_SMTP_HOST!,
    port: config.PORTAL_SMTP_PORT,
    secure: config.PORTAL_SMTP_PORT === 465,
    auth: { type: 'simple', user: config.PORTAL_SMTP_USER!, pass: config.PORTAL_SMTP_PASS! },
    from: config.PORTAL_SMTP_FROM || config.PORTAL_SMTP_USER!,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

export async function sendPortalEmail(
  userId: string,
  input: { to: string; subject: string; text: string; html?: string }
): Promise<void> {
  const mailbox = await prisma.mailbox.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  if (mailbox) {
    try {
      await sendFromMailbox(mailbox, {
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      logger.info({ userId, to: input.to, subject: input.subject }, 'Portal email sent');
      return;
    } catch (err) {
      if (!smtpFallbackConfigured()) throw err;
      logger.warn({ err, userId, to: input.to }, 'Mailbox send failed — using SMTP fallback');
    }
  } else if (!smtpFallbackConfigured()) {
    throw Object.assign(
      new Error('No active connected mailbox — connect one in Integrations before inviting clients'),
      { code: 'NO_MAILBOX', status: 409 }
    );
  }

  await sendViaFallbackSmtp(input);
  logger.info({ userId, to: input.to, subject: input.subject }, 'Portal email sent (SMTP fallback)');
}

/** Absolute base URL for portal links in emails (e.g. https://ysxvisuals.online). */
export function portalBaseUrl(): string {
  const origin = (config.WEB_ORIGIN || 'http://localhost:3001').replace(/\/+$/, '');
  return `${origin}/portal`;
}
