import { ImapFlow } from 'imapflow';
import { logger } from '../logger.js';
import { maskEmail } from '../util/redact.js';
import { Credentials } from './types.js';
import { fetchDuration, fetchTotal } from '../metrics.js';
import type { Response } from 'express';

export type FetchSentInput = {
  host: string;
  port: number;
  secure: boolean;
  auth: Credentials;
  limit: number;
};

export type SentItem = {
  uid: number;
  id?: string;
  subject: string;
  from: string;
  to: string[];
  date: string; // ISO String
  snippet: string;
};

function createClientConfig(input: FetchSentInput | (FetchSentInput & { uid: number }) | (FetchSentInput & { uid: number; partId: string })) {
  const { host, port, secure, auth } = input;

  const clientConfig: any = {
    host,
    port,
    secure,
    logger: false,
    clientInfo: { name: 'SecureMailGateway', version: '1.0.0' },
    emitLogs: false,
    tls: {
      rejectUnauthorized: true,
    },
  };

  if (auth.type === 'oauth2') {
    throw new Error('IMAP OAuth2 not implemented in this version (SMTP only requested)');
  } else {
    clientConfig.auth = {
      user: auth.user,
      pass: auth.pass,
    };
  }

  return clientConfig;
}

async function connectWithTimeout(client: ImapFlow, timeoutMs: number) {
  const connectPromise = client.connect();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('IMAP Connection Timed out')), timeoutMs)
  );
  await Promise.race([connectPromise, timeoutPromise]);
}

async function resolveSentMailbox(client: ImapFlow): Promise<string> {
  let sentPath = '';
  const mailboxes = await client.list();
  const sentBox = mailboxes.find(box => box.specialUse === '\\Sent');
  if (sentBox) {
    sentPath = sentBox.path;
  } else {
    const commonNames = new Set(['Sent', 'Sent Mail', 'Sent Items', 'Enviados', '[Gmail]/Sent Mail']);
    const found = mailboxes.find(box => commonNames.has(box.name) || commonNames.has(box.path));
    if (found) sentPath = found.path;
  }

  if (!sentPath) {
    throw new Error('Could not locate Sent mailbox');
  }

  return sentPath;
}

function buildSnippet(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 200 ? cleaned.slice(0, 200) + '…' : cleaned;
}

export async function fetchSent(input: FetchSentInput): Promise<SentItem[]> {
  const { host, port, secure, auth, limit } = input;
  const start = performance.now();

  const clientConfig = createClientConfig(input);
  const client = new ImapFlow(clientConfig);

  try {
    await connectWithTimeout(client, 15000);

    const sentPath = await resolveSentMailbox(client);
    const lock = await client.getMailboxLock(sentPath);
    const sentItems: SentItem[] = [];

    try {
      const status = await client.status(sentPath, { messages: true, uidNext: true });
      const totalMessages = status.messages || 0;

      if (totalMessages === 0) {
        return [];
      }

      const startSeq = Math.max(1, totalMessages - limit + 1);
      const range = `${startSeq}:*`;

      for await (const message of client.fetch(range, {
        envelope: true,
        bodyStructure: true,
        uid: true,
        source: true,
      })) {
        if (!message.envelope) continue;

        const envelope = message.envelope;
        const from = envelope.from?.[0]?.address || 'unknown';
        const subject = envelope.subject || '(No Subject)';
        const toList =
          Array.isArray(envelope.to)
            ? envelope.to
                .map((t: any) => t?.address)
                .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
            : [];
        const dateHeader = envelope.date as string | undefined;
        const isoDate = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

        const fullSource = (message as any).source?.toString?.() || '';
        const snippet = buildSnippet(fullSource || subject || '');

        sentItems.push({
          uid: message.uid!,
          id: envelope.messageId || undefined,
          subject,
          from,
          to: toList,
          date: isoDate,
          snippet,
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();

    const duration = performance.now() - start;
    fetchDuration.observe(duration / 1000);
    fetchTotal.inc();

    return sentItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (err: any) {
    client.close();
    logger.error({ err, user: maskEmail(auth.user) }, 'IMAP Error');
    throw err;
  }
}

export async function fetchSentMessage(
  input: FetchSentInput & { uid: number }
): Promise<{
  headers: Record<string, string>;
  text?: string;
  html?: string;
  attachments: Array<{ filename:string; size:number; contentType:string; partId: string }>;
}> {
  const { host, port, secure, auth, uid } = input;
  const start = performance.now();

  const clientConfig = createClientConfig(input);
  const client = new ImapFlow(clientConfig);

  try {
    await connectWithTimeout(client, 15000);

    const sentPath = await resolveSentMailbox(client);
    const lock = await client.getMailboxLock(sentPath);

    try {
      const message = await client.fetchOne(uid, {
        envelope: true,
        bodyStructure: true,
        uid: true,
      });

      if (!message) {
        throw new Error(`Message with UID ${uid} not found`);
      }

      if (!message.envelope) {
        throw new Error(`Message with UID ${uid} has no envelope`);
      }

      const envelope = message.envelope;

      const headers: Record<string, string> = {
        subject: envelope.subject || '(No Subject)',
        from: envelope.from?.[0]?.address || 'unknown',
        to:
          envelope.to
            ?.map((t: any) => t.address)
            .filter((addr: string | undefined): addr is string => typeof addr === 'string' && addr.length > 0)
            .join(', ') || '',
        date: envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString(),
        messageId: envelope.messageId || '',
      };

      const attachments: Array<{ filename:string; size:number; contentType:string; partId: string }> = [];
      let textPartId: string | undefined;
      let htmlPartId: string | undefined;

      const walkParts = (struct: any) => {
        if (!struct) return;

        if (Array.isArray(struct.childNodes)) {
          for (const child of struct.childNodes) {
            walkParts(child);
          }
          return;
        }

        if (struct.disposition === 'attachment' || (struct.disposition === 'inline' && struct.parameters?.filename)) {
          attachments.push({
            filename: struct.parameters?.filename || 'unnamed',
            size: struct.size || 0,
            contentType: struct.type,
            partId: struct.part,
          });
          return;
        }

        if (
          struct.type === 'text/plain' &&
          !textPartId &&
          (!struct.disposition || struct.disposition === 'inline')
        ) {
          textPartId = struct.part;
        }

        if (
          struct.type === 'text/html' &&
          !htmlPartId &&
          (!struct.disposition || struct.disposition === 'inline')
        ) {
          htmlPartId = struct.part;
        }
      };

      walkParts((message as any).bodyStructure);

      let textBody = '';
      let htmlBody = '';

      if (textPartId) {
        const { content } = await client.download(uid, textPartId);
        const chunks: Buffer[] = [];
        for await (const chunk of content) {
          chunks.push(chunk as Buffer);
        }
        textBody = Buffer.concat(chunks).toString('utf-8');
      }

      if (htmlPartId) {
        const { content } = await client.download(uid, htmlPartId);
        const chunks: Buffer[] = [];
        for await (const chunk of content) {
          chunks.push(chunk as Buffer);
        }
        htmlBody = Buffer.concat(chunks).toString('utf-8');
      }

      const duration = performance.now() - start;
      fetchDuration.observe(duration / 1000);

      return {
        headers,
        text: textBody,
        html: htmlBody,
        attachments,
      };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    client.close();
    logger.error({ err, user: maskEmail(auth.user) }, 'IMAP single message error');
    throw err;
  }
}

export async function streamAttachment(
  input: FetchSentInput & { uid: number; partId: string },
  res: Response
): Promise<void> {
  const { host, port, secure, auth, uid, partId } = input;

  const clientConfig = createClientConfig(input);
  const client = new ImapFlow(clientConfig);

  try {
    await connectWithTimeout(client, 15000);

    const sentPath = await resolveSentMailbox(client);
    const lock = await client.getMailboxLock(sentPath);

    try {
      const message = await client.fetchOne(uid, {
        bodyStructure: true,
        uid: true,
      });

      if (!message) {
        throw new Error(`Message with UID ${uid} not found`);
      }

      const struct = (message as any).bodyStructure;
      if (!struct) {
        throw new Error('No body structure available for this message');
      }

      let foundPart: any = null;
      const findPart = (node: any) => {
        if (!node) return;
        if (node.part === partId) {
          foundPart = node;
          return;
        }
        if (Array.isArray(node.childNodes)) {
          for (const child of node.childNodes) {
            if (!foundPart) findPart(child);
          }
        }
      };

      findPart(struct);

      if (!foundPart) {
        throw new Error(`Attachment part ${partId} not found`);
      }

      const { content } = await client.download(uid, partId);
      const contentType = foundPart.type || 'application/octet-stream';
      const filename = foundPart.parameters?.filename || 'attachment';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const streamRes = res as any;

      await new Promise((resolve, reject) => {
        content.on('end', resolve);
        content.on('error', reject);
        streamRes.on('close', resolve);
        content.pipe(streamRes);
      });

    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err: any) {
    client.close();
    if (!(res as any).headersSent) throw err;
    logger.error({ err }, 'Streaming error');
  }
}
