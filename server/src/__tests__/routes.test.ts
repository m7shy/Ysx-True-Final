import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * The mail routes talk to providers via `nodemailer` (SMTP send) and
 * `imapflow`'s `ImapFlow` (fetch Sent), imported directly in
 * src/mail/routes.ts. We mock those two modules so tests never touch real
 * Gmail/Zoho/Microsoft network services. (The previous tests mocked
 * ../mail/smtpClient.js / ../mail/imapClient.js, which the routes do not
 * import, so the mocks intercepted nothing.)
 */

// Hoisted so the vi.mock factories below can reference them and tests can assert.
const { sendMailMock, createTransportMock, imapMessages } = vi.hoisted(() => {
  const sendMailMock = vi.fn(async () => ({ messageId: 'mock-message-id' }));
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  // Messages the fake IMAP "Sent" mailbox yields.
  const imapMessages: { current: any[] } = { current: [] };
  return { sendMailMock, createTransportMock, imapMessages };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock('imapflow', () => {
  class FakeImapFlow {
    public mailbox: { exists: number } | null = null;
    constructor(_opts: unknown) {}
    async connect(): Promise<void> {}
    async logout(): Promise<void> {}
    async list(): Promise<unknown[]> {
      // One special-use \Sent mailbox so findSentBoxPath resolves immediately.
      return [{ path: '[Gmail]/Sent Mail', specialUse: '\\Sent', subscribed: true }];
    }
    async mailboxOpen(_path: string): Promise<{ exists: number }> {
      this.mailbox = { exists: imapMessages.current.length };
      return this.mailbox;
    }
    async *fetch(): AsyncGenerator<unknown> {
      for (const msg of imapMessages.current) yield msg;
    }
    async search(): Promise<number[]> {
      return [];
    }
  }
  return { ImapFlow: FakeImapFlow };
});

// Import the app only after the mocks are registered (vi.mock is hoisted).
import { app } from '../index.js';

const sentMsg = (uid: number) => ({
  uid,
  envelope: {
    subject: `Test ${uid}`,
    from: [{ address: 'me@gmail.com' }],
    to: [{ address: `u${uid}@example.com` }],
    date: new Date('2024-01-01T00:00:00.000Z'),
    messageId: `<msg-${uid}@example.com>`,
  },
});

beforeAll(() => {
  // getSmtpConfig/getImapConfig read these directly from process.env.
  process.env.GMAIL_USER = 'test@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
});

beforeEach(() => {
  vi.clearAllMocks();
  imapMessages.current = [sentMsg(1), sentMsg(2), sentMsg(3)];
});

describe('Mail Routes', () => {
  it('GET /api/mail/sent should return items from the Sent mailbox', async () => {
    const res = await request(app)
      .get('/api/mail/sent')
      .query({ provider: 'gmail', limit: 2 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // limit=2 caps the result even though the fake mailbox has 3 messages.
    expect(res.body.items).toHaveLength(2);
    // Sorted newest-first by uid.
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({ uid: 3, subject: 'Test 3' })
    );
  });

  it('POST /api/mail/send should return { ok: true, messageId }', async () => {
    const res = await request(app)
      .post('/api/mail/send')
      .send({
        provider: 'gmail',
        from: 'me@gmail.com',
        to: 'you@gmail.com',
        subject: 'Hello',
        text: 'World',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, messageId: 'mock-message-id' });
    expect(createTransportMock).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalled();
  });

  it('POST /api/mail/send should fail with INVALID_PROVIDER for an unknown provider', async () => {
    const res = await request(app)
      .post('/api/mail/send')
      .send({
        provider: 'invalid',
        from: 'me@gmail.com',
        to: 'you@gmail.com',
        subject: 'Hello',
        text: 'World',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROVIDER');
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
