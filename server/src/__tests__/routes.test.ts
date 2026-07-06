import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mail/followups/gemini routers are tenant-scoped and must never touch a real
// mailbox during tests; a mailbox-less Prisma stand-in is enough to prove the
// requireAuth gate rejects unauthenticated calls before any DB/IMAP work.
vi.mock('../db/prisma.js', () => ({
  prisma: {
    user: { findUnique: async () => null },
    mailbox: { findMany: async () => [], findFirst: async () => null },
  },
}));

import { app } from '../index.js';

describe('multi-tenant gating', () => {
  it('rejects GET /api/mail/sent without a token', async () => {
    const res = await request(app).get('/api/mail/sent').query({ provider: 'gmail' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH');
  });

  it('rejects POST /api/mail/send without a token', async () => {
    const res = await request(app)
      .post('/api/mail/send')
      .send({ provider: 'gmail', to: 'you@example.com', subject: 'Hi', text: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/mail/health without a token', async () => {
    const res = await request(app).get('/api/mail/health');
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/followups without a token', async () => {
    const res = await request(app).get('/api/followups');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Bearer token', async () => {
    const res = await request(app)
      .get('/api/mail/sent')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});
