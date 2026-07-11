import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// In-memory mailbox table stand-in: one row owned by tenant u1.
const deleted: string[] = [];
vi.mock('../db/prisma.js', () => ({
  prisma: {
    // requireActiveTenant resolves the user's status before allowing mutations.
    user: { findUnique: async ({ where }: any) => ({ id: where.id, status: 'ACTIVE' }) },
    mailbox: {
      findMany: async () => [],
      findFirst: async ({ where }: any) =>
        where.id === 'mb1' && where.userId === 'u1'
          ? { id: 'mb1', email: 'me@example.com' }
          : null,
      delete: async ({ where }: any) => {
        deleted.push(where.id);
        return { id: where.id };
      },
    },
  },
}));

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';

describe('DELETE /api/mail/mailboxes/:id (disconnect)', () => {
  it('rejects an unauthenticated call', async () => {
    const res = await request(app).delete('/api/mail/mailboxes/mb1');
    expect(res.status).toBe(401);
    expect(deleted).toHaveLength(0);
  });

  it('deletes the tenant-owned mailbox', async () => {
    const token = signAccessToken({ userId: 'u1', email: 'u1@example.com' });
    const res = await request(app)
      .delete('/api/mail/mailboxes/mb1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, email: 'me@example.com' });
    expect(deleted).toEqual(['mb1']);
  });

  it("404s (and does not delete) another tenant's mailbox", async () => {
    const before = deleted.length;
    const token = signAccessToken({ userId: 'u2', email: 'u2@example.com' });
    const res = await request(app)
      .delete('/api/mail/mailboxes/mb1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(deleted).toHaveLength(before);
  });
});
