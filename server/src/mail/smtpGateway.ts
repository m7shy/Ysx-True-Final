import type { Mailbox } from '@prisma/client';

import { MailError } from '../httpErrors.js';
import { logger } from '../logger.js';
import { prisma } from '../db/prisma.js';
import { sendMail } from './smtpClient.js';
import { recordEmailSent, assertUnderEmailLimit } from '../billing/usage.js';
import {
  getMailboxConnection,
  connectionForMailbox,
  recordMailboxSend,
  type MailboxConnection,
  type WireProvider,
} from '../creds/mailboxStore.js';

export function parseProvider(raw: unknown, fallback: WireProvider = 'gmail'): WireProvider {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'gmail' || v === 'google') return 'gmail';
  if (v === 'microsoft' || v === 'outlook' || v === 'office365') return 'microsoft';
  throw new MailError('DENIED', `Unsupported provider: ${raw}`);
}

/**
 * IMAP connection config for a tenant's mailbox, resolved from the database.
 * Auth is XOAUTH2: { user, accessToken } (token refreshed on read as needed).
 */
export async function getImapConfig(userId: string, provider: WireProvider) {
  const conn = await getMailboxConnection(userId, provider);
  return {
    host: conn.imapHost,
    port: conn.imapPort,
    secure: conn.imapSecure,
    auth: { user: conn.email, accessToken: conn.accessToken },
  };
}

/** SMTP connection config for a tenant's mailbox, resolved from the database. */
export async function getSmtpConfig(userId: string, provider: WireProvider) {
  const conn = await getMailboxConnection(userId, provider);
  return {
    host: conn.smtpHost,
    port: conn.smtpPort,
    secure: conn.smtpSecure,
    auth: { user: conn.email, accessToken: conn.accessToken },
  };
}

function formatFromHeader(email: string): string {
  const name = String(process.env.MAIL_FROM_NAME ?? '').trim();
  if (!name) return email;
  const safe = name.replace(/"/g, '\\"');
  return `"${safe}" <${email}>`;
}

export interface SmtpSendInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: any[];
  /** Extra RFC-822 headers (e.g. List-Unsubscribe on campaign sends). */
  headers?: Record<string, string>;
}

export async function sendSmtpMail(userId: string, provider: WireProvider, input: SmtpSendInput): Promise<string> {
  await assertUnderEmailLimit(userId); // throws LimitExceededError, tier cap reached
  const conn = await getMailboxConnection(userId, provider);
  const messageId = await sendViaConnection(conn, input);
  await recordEmailSent(userId); // metered billing usage; never throws

  // Count the send against the MAILBOX's daily warm-up cap, not just the
  // tenant's billing meter. These are two different limits and only the
  // billing one was being maintained here.
  //
  // This is the path the follow-up scheduler uses, and follow-ups are the
  // majority of a sequence's volume — so the mailbox's `dailyLimit` (the
  // number that exists to stop the provider throttling a warming domain) was
  // being silently overshot by every follow-up ever sent. The campaign worker
  // and the unibox reply route both call recordMailboxSend themselves after
  // sendFromMailbox; this path had no equivalent, which is exactly the kind of
  // "same rule implemented in some places and not others" drift that makes a
  // counter quietly stop meaning anything.
  //
  // Swallowed on failure: the message has already gone out, and turning a
  // counter error into a failed send would invite a retry that sends twice.
  try {
    const mailbox = await prisma.mailbox.findUnique({ where: { id: conn.mailboxId } });
    if (mailbox) await recordMailboxSend(mailbox);
  } catch (err) {
    logger.error({ err, mailboxId: conn.mailboxId }, 'Send succeeded but mailbox send-count update failed');
  }

  return messageId;
}

/**
 * Send from a SPECIFIC mailbox row — used by the campaign worker's inbox
 * rotation, which picks the mailbox itself instead of resolving by provider.
 */
export async function sendFromMailbox(mailbox: Mailbox, input: SmtpSendInput): Promise<string> {
  await assertUnderEmailLimit(mailbox.userId); // throws LimitExceededError, tier cap reached
  const conn = await connectionForMailbox(mailbox);
  const messageId = await sendViaConnection(conn, input);
  await recordEmailSent(mailbox.userId); // metered billing usage; never throws
  return messageId;
}

async function sendViaConnection(conn: MailboxConnection, input: SmtpSendInput): Promise<string> {
  const provider = conn.provider;
  // HARD RULE: SMTP From MUST be the authenticated mailbox user.
  // If the client sends "from", it is treated as Reply-To only (see routes).
  const from = formatFromHeader(conn.email);

  return await sendMail({
    host: conn.smtpHost,
    port: conn.smtpPort,
    secure: conn.smtpSecure,
    auth: { type: 'oauth2', user: conn.email, accessToken: conn.accessToken },
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: input.attachments,
    headers: input.headers,
    // Microsoft SMTP can be slow to connect/greet.
    connectionTimeout: provider === 'microsoft' ? 60000 : undefined,
    greetingTimeout: provider === 'microsoft' ? 60000 : undefined,
    socketTimeout: provider === 'microsoft' ? 120000 : undefined,
  } as any);
}
