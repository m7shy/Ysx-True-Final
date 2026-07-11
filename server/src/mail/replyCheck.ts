import { ImapFlow } from 'imapflow';
import { logger } from '../logger.js';
import { getImapConfig } from './smtpGateway.js';
import type { WireProvider } from '../creds/mailboxStore.js';

const DEBUG_REPLY_DETECT = String(process.env.DEBUG_REPLY_DETECT ?? '').trim() === '1';

/**
 * Canonicalize Message-IDs so we can match regardless of angle brackets.
 *
 * Canonical format used internally: no surrounding angle brackets.
 * Example:
 *   - "<4117c0...@domain>" -> "4117c0...@domain"
 *   - "4117c0...@domain"  -> "4117c0...@domain"
 */
export function normalizeMessageId(raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return v.replace(/[<>]/g, '').trim();
}

/**
 * Format a Message-ID for use in RFC 5322 headers (angle brackets required).
 */
export function formatMessageIdForHeader(raw: unknown): string | undefined {
  const id = normalizeMessageId(raw);
  if (!id) return undefined;
  return `<${id}>`;
}

function debugLog(msg: string, extra?: Record<string, unknown>): void {
  if (!DEBUG_REPLY_DETECT) return;
  logger.debug(extra ?? {}, msg);
}

/**
 * Reply detection used by the follow-up scheduler.
 *
 * We check the sender mailbox INBOX for messages:
 * - From: recipientEmail
 * - Sent/received since initialSentAt
 * - Optionally referencing the original Message-ID (In-Reply-To / References)
 */
export async function hasRecipientReplied(input: {
  userId: string;
  provider: WireProvider;
  recipientEmail: string;
  initialSentAt: string;
  originalMessageId?: string;
}): Promise<boolean> {
  const recipientEmail = String(input.recipientEmail ?? '').trim().toLowerCase();
  if (!recipientEmail) return false;

  const sinceDate = new Date(input.initialSentAt);
  const hasValidSince = !Number.isNaN(sinceDate.getTime());

  let imap: Awaited<ReturnType<typeof getImapConfig>>;
  try {
    // Sender mailbox credentials resolved from the DB for this tenant.
    imap = await getImapConfig(input.userId, input.provider);
  } catch (err: any) {
    debugLog('Reply check: failed to resolve mailbox credentials', {
      provider: input.provider,
      err: err?.message ?? String(err),
    });
    return false;
  }

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port ?? 993,
    secure: imap.secure ?? true,
    auth: imap.auth,
    logger: false,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: input.provider === 'microsoft' ? 60000 : 15000,
    greetingTimeout: input.provider === 'microsoft' ? 60000 : 15000,
    socketTimeout: input.provider === 'microsoft' ? 120000 : 15000,
  } as any);

  try {
    await client.connect();

    // Search INBOX for replies
    await client.mailboxOpen('INBOX', { readOnly: true });

    // Criteria enforcing the sender (used for fallback / subject match)
    const baseCriteriaSender: any = {
      from: recipientEmail,
    };

    // Criteria IGNORING the sender (used for precise Message-ID match)
    // We trust that if an email references our Message-ID, it is relevant to this thread
    // regardless of which alias/colleague sent it.
    const baseCriteriaId: any = {};

    if (hasValidSince) {
      // `since` uses INTERNALDATE which is good enough for gating followups.
      baseCriteriaSender.since = sinceDate;
      baseCriteriaId.since = sinceDate;
    }

    const originalMessageId = normalizeMessageId(input.originalMessageId);

    debugLog('Reply check: starting IMAP search', {
      provider: input.provider,
      hasValidSince,
      since: hasValidSince ? sinceDate.toISOString() : undefined,
      hasOriginalMessageId: Boolean(originalMessageId),
    });

    // If we don't have a Message-ID, fall back to "any inbound message from recipient since initialSentAt".
    if (!originalMessageId) {
      const r = await client.search(baseCriteriaSender);
      return Array.isArray(r) ? r.length > 0 : false;
    }

    // IMAP SEARCH HEADER matches substring in header value.
    // Searching for the canonical (unbracketed) ID matches both:
    //   - In-Reply-To: <id@domain>
    //   - In-Reply-To: id@domain
    const criteriaInReplyTo = {
      ...baseCriteriaId,
      header: {
        'in-reply-to': originalMessageId,
      },
    };

    const criteriaReferences = {
      ...baseCriteriaId,
      header: {
        references: originalMessageId,
      },
    };

    const r1 = await client.search(criteriaInReplyTo);
    if (Array.isArray(r1) && r1.length > 0) {
      debugLog('Reply check: matched In-Reply-To', { matches: r1.length });
      return true;
    }

    const r2 = await client.search(criteriaReferences);
    if (Array.isArray(r2) && r2.length > 0) {
      debugLog('Reply check: matched References', { matches: r2.length });
      return true;
    }

    // Optional last-resort fallback: any inbound email from recipient whose subject looks like a reply.
    // This helps when clients omit References/In-Reply-To but still use a Re: subject.
    const r3 = await client.search(baseCriteriaSender);
    if (Array.isArray(r3) && r3.length > 0) {
      const sample = r3.slice(-10);
      for await (const msg of client.fetch(sample, { envelope: true })) {
        const subj = String((msg as any)?.envelope?.subject ?? '').trim();
        if (/^re\s*:/i.test(subj)) {
          debugLog('Reply check: matched fallback subject', { subject: subj });
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    logger.error({ err }, 'Error checking replies');
    return false;
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}
