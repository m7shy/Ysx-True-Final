import { ImapFlow } from 'imapflow';
import { logger } from '../logger.js';
import { getImapConfig } from './smtpGateway.js';
import type { ProviderName } from './types.js';

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

function pickUserPass(auth: any): { user: string; pass: string } {
  // Support BOTH shapes:
  // 1) { user, pass }  (what your getImapConfig returns right now)
  // 2) { type:'simple', user, pass } (what some refactors use)
  if (auth && typeof auth === 'object') {
    if ('user' in auth && 'pass' in auth) {
      return { user: String(auth.user), pass: String(auth.pass) };
    }
    if ('type' in auth && auth.type === 'simple' && 'user' in auth && 'pass' in auth) {
      return { user: String(auth.user), pass: String(auth.pass) };
    }
  }
  throw new Error('Invalid IMAP auth config (expected user/pass).');
}

function asArray(result: false | number[]): number[] {
  return Array.isArray(result) ? result : [];
}

export async function hasRecipientReplied(input: {
  provider: ProviderName;
  recipientEmail: string;
  initialSentAt: string;
  originalMessageId?: string;
}): Promise<boolean> {
  const recipientEmail = normalizeEmail(input.recipientEmail);

  const since = new Date(input.initialSentAt);
  if (Number.isNaN(since.getTime())) {
    throw new Error(`Invalid initialSentAt: ${input.initialSentAt}`);
  }

  const imap = getImapConfig(input.provider);
  const { user, pass } = pickUserPass((imap as any).auth);

  const client = new ImapFlow({
    host: (imap as any).host,
    port: (imap as any).port ?? 993,
    secure: (imap as any).secure ?? true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    if (input.originalMessageId) {
      const mid = input.originalMessageId;

      const direct = asArray(
        await client.search({
          from: recipientEmail,
          since,
          or: [
            { header: { 'in-reply-to': mid } },
            { header: { references: mid } },
          ],
        })
      );

      if (direct.length > 0) return true;

      const any = asArray(await client.search({ from: recipientEmail, since }));
      return any.length > 0;
    }

    const any = asArray(await client.search({ from: recipientEmail, since }));
    return any.length > 0;
  } catch (err) {
    logger.error({ err, provider: input.provider, recipientEmail }, 'replyCheck failed');
    throw err;
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        // ignore
      }
    }
  }
}
