
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

// Mock configuration to provide credentials
vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return {
    ...actual,
    config: {
      ...actual.config,
      GMAIL_USER: 'test@gmail.com',
      GMAIL_APP_PASSWORD: 'pass',
      ZOHO_USER: 'test@zoho.com',
      ZOHO_APP_PASSWORD: 'pass',
      ALLOWLIST_HOSTS: new Set(['imap.gmail.com', 'smtp.gmail.com', 'imap.zoho.com', 'smtp.zoho.com']),
    },
  };
});

// Mock the clients
vi.mock('../mail/smtpClient.js');
vi.mock('../mail/imapClient.js');

import { sendMail } from '../mail/smtpClient.js';
import { fetchSent } from '../mail/imapClient.js';

describe('Mail Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/mail/sent should return items', async () => {
    const res = await request(app)
      .get('/api/mail/sent')
      .query({ provider: 'gmail', limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3); // Mock returns 3 fixed items
    expect(fetchSent).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });

  it('POST /api/mail/send should return messageId', async () => {
    const res = await request(app)
      .post('/api/mail/send')
      .send({
        provider: 'gmail',
        from: 'me@gmail.com',
        to: 'you@gmail.com',
        subject: 'Hello',
        text: 'World'
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messageId: 'mock-message-id' });
    expect(sendMail).toHaveBeenCalled();
  });

  it('POST /api/mail/send should fail with invalid provider', async () => {
    const res = await request(app)
      .post('/api/mail/send')
      .send({
        provider: 'invalid',
        from: 'me@gmail.com',
        to: 'you@gmail.com',
        subject: 'Hello',
        text: 'World'
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });
});
