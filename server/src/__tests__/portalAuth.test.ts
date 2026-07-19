import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// In-memory Prisma stand-in for the portal auth flows.
const sentEmails: any[] = [];

vi.mock('../db/prisma.js', () => {
  const clientUsers = new Map<string, any>();
  const tokens = new Map<string, any>(); // keyed by tokenHash
  const clients = new Map<string, any>();
  let seq = 1;

  clients.set('c1', { id: 'c1', name: 'Acme Client', companyName: 'Acme Co' });
  clientUsers.set('cu1', {
    id: 'cu1',
    clientId: 'c1',
    userId: 'owner1',
    email: 'client@example.com',
    passwordHash: null,
    tokenVersion: 0,
    lastLoginAt: null,
  });

  return {
    prisma: {
      user: { findUnique: async () => null },
      mailbox: {
        findMany: async () => [],
        findFirst: async ({ where }: any) =>
          where?.userId === 'owner1'
            ? { id: 'mb1', userId: 'owner1', email: 'owner@agency.com', provider: 'GMAIL', isActive: true }
            : null,
      },
      client: {
        findUnique: async ({ where }: any) => clients.get(where.id) ?? null,
      },
      clientUser: {
        findUnique: async ({ where }: any) => {
          if (where.email) return [...clientUsers.values()].find((u) => u.email === where.email) ?? null;
          if (where.id) return clientUsers.get(where.id) ?? null;
          return null;
        },
        update: async ({ where, data }: any) => {
          const u = clientUsers.get(where.id);
          Object.assign(u, data);
          return u;
        },
      },
      clientLoginToken: {
        create: async ({ data }: any) => {
          const row = { id: `t${seq++}`, usedAt: null, createdAt: new Date(), ...data };
          tokens.set(row.tokenHash, row);
          return row;
        },
        updateMany: async ({ where, data }: any) => {
          const row = tokens.get(where.tokenHash);
          const valid =
            row && row.kind === where.kind && row.usedAt === null && row.expiresAt > where.expiresAt.gt;
          if (!valid) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
        findUnique: async ({ where }: any) => {
          const row = tokens.get(where.tokenHash);
          if (!row) return null;
          const clientUser = clientUsers.get(row.clientUserId);
          return { ...row, clientUser: { ...clientUser, client: clients.get(clientUser.clientId) } };
        },
      },
    },
  };
});

vi.mock('../mail/smtpGateway.js', async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    sendFromMailbox: async (_mailbox: any, input: any) => {
      sentEmails.push(input);
      return 'msg-id-1';
    },
  };
});

import { app } from '../index.js';
import {
  signClientAccessToken,
  signClientRefreshToken,
  verifyClientAccessToken,
} from '../auth/clientJwt.js';
import { signAccessToken, verifyAccessToken, verifyRefreshToken } from '../auth/jwt.js';
import { createLoginToken, consumeLoginToken } from '../portal/tokens.js';
import { requireClientAuth } from '../auth/clientMiddleware.js';
import express from 'express';
import type { Response } from 'express';

const cu = { clientUserId: 'cu1', clientId: 'c1', userId: 'owner1', email: 'client@example.com', tokenVersion: 0 };

describe('client JWT audience separation', () => {
  it('round-trips a client access token', () => {
    const tok = signClientAccessToken(cu);
    const claims = verifyClientAccessToken(tok);
    expect(claims.sub).toBe('cu1');
    expect(claims.clientId).toBe('c1');
    expect(claims.aud).toBe('client');
  });

  it('rejects a CRM access token on client verification', () => {
    const crmToken = signAccessToken({ userId: 'owner1', email: 'admin@agency.com' });
    expect(() => verifyClientAccessToken(crmToken)).toThrow();
  });

  it('rejects a CLIENT access token on CRM verification (reverse direction)', () => {
    // Regression guard: jwt.verify ignores `aud` unless asked, so the CRM
    // verifier must explicitly reject audience-scoped (portal) tokens.
    const clientToken = signClientAccessToken(cu);
    expect(() => verifyAccessToken(clientToken)).toThrow();
  });

  it('rejects a CLIENT refresh token on CRM refresh verification', () => {
    const clientRefresh = signClientRefreshToken(cu);
    expect(() => verifyRefreshToken(clientRefresh)).toThrow();
  });

  it('a client token gets 401 on a CRM route over HTTP', async () => {
    const res = await request(app)
      .get('/api/mail/health')
      .set('Authorization', `Bearer ${signClientAccessToken(cu)}`);
    expect(res.status).toBe(401);
  });

  it('rejects a client refresh token where an access token is expected', () => {
    const refresh = signClientRefreshToken(cu);
    expect(() => verifyClientAccessToken(refresh)).toThrow();
  });

  it('requireClientAuth rejects a CRM token and accepts a client token', async () => {
    const mini = express();
    mini.get('/probe', requireClientAuth, (req, res: Response) => {
      res.json({ clientId: req.clientAuth?.clientId });
    });

    const crmToken = signAccessToken({ userId: 'owner1', email: 'admin@agency.com' });
    const denied = await request(mini).get('/probe').set('Authorization', `Bearer ${crmToken}`);
    expect(denied.status).toBe(401);

    const ok = await request(mini)
      .get('/probe')
      .set('Authorization', `Bearer ${signClientAccessToken(cu)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.clientId).toBe('c1');
  });
});

describe('portal auth HTTP flow', () => {
  it('magic-link request always returns 200 and emails a real account', async () => {
    const unknown = await request(app)
      .post('/api/portal/auth/magic-link')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);

    const known = await request(app)
      .post('/api/portal/auth/magic-link')
      .send({ email: 'client@example.com' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body); // uniform response — no enumeration
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('client@example.com');
    expect(sentEmails[0].text).toContain('/portal/login?token=');
  });

  it('consumes a magic link exactly once', async () => {
    const raw = sentEmails[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];

    const first = await request(app).post('/api/portal/auth/magic-link/consume').send({ token: raw });
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.client.name).toBe('Acme Client');
    expect(verifyClientAccessToken(first.body.accessToken).aud).toBe('client');

    const replay = await request(app).post('/api/portal/auth/magic-link/consume').send({ token: raw });
    expect(replay.status).toBe(401);
  });

  it('password login fails while unset, works after refresh-token round trip', async () => {
    // No password set yet → 401 even with any password.
    const early = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: 'client@example.com', password: 'whatever123' });
    expect(early.status).toBe(401);

    // Refresh with a valid client refresh token.
    const refresh = await request(app)
      .post('/api/portal/auth/refresh')
      .send({ refreshToken: signClientRefreshToken(cu) });
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTruthy();

    // Stale tokenVersion is revoked.
    const stale = await request(app)
      .post('/api/portal/auth/refresh')
      .send({ refreshToken: signClientRefreshToken({ ...cu, tokenVersion: 9 }) });
    expect(stale.status).toBe(401);
  });

  it('rejects an expired magic-link token', async () => {
    const raw = await createLoginToken('cu1', 'MAGIC_LINK');
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(16 * 60 * 1000); // past the 15-minute TTL
      expect(await consumeLoginToken(raw, 'MAGIC_LINK')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    // Still consumable is what we're guarding against — after real-time restore
    // the row was never marked used, but its expiry has genuinely NOT passed,
    // so a fresh consume succeeds; that's fine (the guard above is the point).
  });

  it('rejects a garbage token outright', async () => {
    const res = await request(app)
      .post('/api/portal/auth/magic-link/consume')
      .send({ token: 'definitely-not-a-real-token' });
    expect(res.status).toBe(401);
  });
});
