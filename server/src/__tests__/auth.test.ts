import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// In-memory Prisma stand-in so auth flows run without a live database.
vi.mock('../db/prisma.js', () => {
  const users = new Map<string, any>();
  let seq = 1;
  const now = () => new Date();
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: any) => {
          if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
          if (where.id) return users.get(where.id) ?? null;
          return null;
        },
        create: async ({ data }: any) => {
          const u = {
            id: `u${seq++}`,
            tokenVersion: 0,
            lastLoginAt: null,
            createdAt: now(),
            updatedAt: now(),
            signatures: null,
            settings: null,
            ...data,
          };
          users.set(u.id, u);
          return u;
        },
        update: async ({ where, data }: any) => {
          const u = users.get(where.id);
          Object.assign(u, data);
          return u;
        },
      },
      mailbox: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    },
  };
});

import { app } from '../index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/jwt.js';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('jwt', () => {
  it('round-trips an access token and rejects a refresh token in its place', () => {
    const access = signAccessToken({ userId: 'u1', email: 'a@b.com' });
    const claims = verifyAccessToken(access);
    expect(claims.sub).toBe('u1');
    expect(claims.email).toBe('a@b.com');
    expect(claims.typ).toBe('access');

    const refresh = signRefreshToken({ userId: 'u1', email: 'a@b.com', tokenVersion: 0 });
    expect(() => verifyAccessToken(refresh)).toThrow();
    expect(verifyRefreshToken(refresh).ver).toBe(0);
  });
});

describe('auth HTTP flow', () => {
  const email = 'tester@example.com';
  const password = 'sup3rsecret!';

  it('signs up, logs in, refreshes, and hydrates /me', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email, password });
    expect(signup.status).toBe(201);
    expect(signup.body.accessToken).toBeTruthy();
    expect(signup.body.refreshToken).toBeTruthy();
    expect(signup.body.user.email).toBe(email);
    expect(signup.body.user).not.toHaveProperty('passwordHash');

    // Duplicate signup is rejected.
    const dup = await request(app).post('/api/auth/signup').send({ email, password });
    expect(dup.status).toBe(409);

    // Wrong password (valid length, so it passes validation) → generic 401.
    const bad = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-123' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');

    // Correct login.
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();

    // Refresh exchange.
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTruthy();

    // /me with the access token.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects weak/invalid signup input', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'x', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('rejects a refresh token whose tokenVersion is stale', async () => {
    const stale = signRefreshToken({ userId: 'ghost', email: 'g@h.com', tokenVersion: 5 });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: stale });
    expect(res.status).toBe(401);
  });
});
