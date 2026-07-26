import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

// In-memory Prisma stand-in for the portal auth flows.
const sentEmails: any[] = [];

vi.mock('../db/prisma.js', () => {
  const clientUsers = new Map<string, any>();
  const tokens = new Map<string, any>(); // keyed by tokenHash
  const clients = new Map<string, any>();
  let seq = 1;

  clients.set('c1', { id: 'c1', name: 'Acme Client', companyName: 'Acme Co', status: 'ACTIVE' });
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
          // Compound unique (userId, email) — emails are scoped per agency now,
          // so a bare-email lookup is no longer a unique key.
          if (where.userId_email) {
            return (
              [...clientUsers.values()].find(
                (u) => u.userId === where.userId_email.userId && u.email === where.userId_email.email,
              ) ?? null
            );
          }
          if (where.email) return [...clientUsers.values()].find((u) => u.email === where.email) ?? null;
          if (where.id) return clientUsers.get(where.id) ?? null;
          return null;
        },
        // Portal login and magic-link resolve an address that may exist at more
        // than one agency, so they use findMany and disambiguate themselves.
        findMany: async ({ where }: any = {}) => {
          let rows = [...clientUsers.values()];
          if (where?.email) rows = rows.filter((u) => u.email === where.email);
          if (where?.userId) rows = rows.filter((u) => u.userId === where.userId);
          return rows;
        },
        update: async ({ where, data }: any) => {
          const u = clientUsers.get(where.id);
          // Mirror Prisma's { increment } numeric update operator so routes
          // that bump tokenVersion (e.g. set-password) work against this stand-in.
          for (const [k, v] of Object.entries(data)) {
            u[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (u[k] ?? 0) + (v as any).increment : v;
          }
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
        // Used by hasUnexpiredMagicLink() to suppress minting a duplicate
        // magic link while a valid one is still outstanding.
        findFirst: async ({ where }: any) => {
          for (const row of tokens.values()) {
            if (
              row.clientUserId === where.clientUserId &&
              row.kind === where.kind &&
              row.usedAt === null &&
              row.expiresAt > where.expiresAt.gt
            ) {
              return row;
            }
          }
          return null;
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

    // The mint+send work runs in a detached promise that resolves after the
    // HTTP response is flushed. vi.waitFor polls until the assertion passes
    // (up to 1 s) so we don't rely on a fixed sleep.
    await vi.waitFor(() => {
      expect(sentEmails.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 1000 });
    expect(sentEmails[0].to).toBe('client@example.com');
    expect(sentEmails[0].text).toContain('/portal/login?token=');
  });

  it('second magic-link request while an unexpired token already exists does not send another email', async () => {
    // sentEmails already has the token from the previous test; a second request
    // for the same address must be a no-op (deduplication guard) so the
    // tenant's email quota is not burned and the client is not confused by
    // two separate links in their inbox.
    const emailCountBefore = sentEmails.length;
    await request(app)
      .post('/api/portal/auth/magic-link')
      .send({ email: 'client@example.com' });
    // Drain the event loop so any async work triggered by the handler
    // completes before we snapshot the count.
    await vi.waitFor(() => {
      // Count must remain stable — allow a short polling window.
      expect(sentEmails.length).toBe(emailCountBefore);
    }, { timeout: 500 });
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

  it('the session handed back by set-password survives a refresh', async () => {
    // Regression guard. set-password bumps tokenVersion to evict any session an
    // attacker already holds. If the response were minted from the pre-update
    // row it would carry the OLD ver, so the client's very first refresh would
    // 401 and log them straight back out — a freshly invited client would be
    // unable to stay signed in.
    const invite = await createLoginToken('cu1', 'INVITE');
    const setPw = await request(app)
      .post('/api/portal/auth/set-password')
      .send({ token: invite, password: 'a-real-password' });
    expect(setPw.status).toBe(201);

    // The refresh token is now an HttpOnly cookie rather than a body field.
    const cookie = (setPw.headers['set-cookie'] as unknown as string[] | undefined)
      ?.find((c) => c.startsWith('ysxportal_rt='));
    expect(cookie).toMatch(/HttpOnly/i);
    const refreshToken = decodeURIComponent(cookie!.split(';')[0].split('=')[1]);

    const refreshed = await request(app)
      .post('/api/portal/auth/refresh')
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
  });
});

describe('portal logout clears the refresh cookie', () => {
  // The portal's Sign out button called no endpoint at all — it only nulled
  // in-memory state, so the HttpOnly ysxportal_rt cookie survived and the next
  // page load's silent refresh signed the visitor straight back in.
  it('POST /api/portal/auth/logout expires the cookie without requiring auth', async () => {
    const res = await request(app).post('/api/portal/auth/logout');
    expect(res.status).toBe(200);

    const cleared = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith('ysxportal_rt='),
    );
    expect(cleared).toBeTruthy();
    // The value must be emptied AND the cookie actually deleted. The first
    // version of this assertion accepted either condition, so it passed while
    // clearCookie was inheriting maxAge from the set-options and re-issuing the
    // cookie with a 30-day future expiry - the token was destroyed, but the
    // cookie lingered. Caught by reading the live Set-Cookie header after
    // deploy, not by the test.
    expect(cleared).toMatch(/ysxportal_rt=;/);
    expect(cleared).not.toMatch(/Max-Age=\d{3,}/);
  });
});
