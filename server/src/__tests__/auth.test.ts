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
          // Mirror Prisma's { increment } numeric update operator so routes
          // that bump tokenVersion (logout-all, change-password) work here.
          for (const [k, v] of Object.entries(data)) {
            u[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (u[k] ?? 0) + (v as any).increment : v;
          }
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


// The refresh token is no longer returned in the response body — it is set as
// an HttpOnly cookie. These helpers read it back off set-cookie so the tests
// exercise the same path a browser would.
function refreshCookie(res: any): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  return raw?.find((c) => c.startsWith('ysxflow_rt='));
}
function refreshTokenFrom(res: any): string {
  const c = refreshCookie(res);
  return c ? decodeURIComponent(c.split(';')[0].split('=')[1]) : '';
}

describe('auth HTTP flow', () => {
  const email = 'tester@example.com';
  const password = 'sup3rsecret!';

  it('signs up, logs in, refreshes, and hydrates /me', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email, password });
    expect(signup.status).toBe(201);
    expect(signup.body.accessToken).toBeTruthy();
    // Refresh token now rides in an HttpOnly cookie, never the body.
    expect(signup.body.refreshToken).toBeUndefined();
    expect(refreshCookie(signup)).toMatch(/HttpOnly/i);
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
      .set('Cookie', [`ysxflow_rt=${refreshTokenFrom(login)}`]);
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
    const res = await request(app).post('/api/auth/refresh').set('Cookie', [`ysxflow_rt=${stale}`]);
    expect(res.status).toBe(401);
  });

  // The HttpOnly-cookie migration is worth nothing while a body fallback also
  // accepts the token: anything exfiltrated from localStorage before the
  // migration (or via any XSS since) stays usable by POSTing it as JSON from
  // any context, and CORS does not prevent sending such a request.
  it('does NOT accept a refresh token supplied in the request body', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'bodyfallback@example.com', password: 'correct-horse-battery' });
    expect(signup.status).toBe(201);
    const token = refreshTokenFrom(signup);
    expect(token).toBeTruthy();

    // Deliberately no Cookie header — body only, exactly as a pre-cookie
    // client or an attacker replaying a stolen token would send it.
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe('logout-all', () => {
  const email = 'logout-all@example.com';
  const password = 'sup3rsecret!';

  it('invalidates a previously issued refresh token', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email, password });
    const accessToken = signup.body.accessToken;
    const refreshToken = refreshTokenFrom(signup);

    const before = await request(app).post('/api/auth/refresh').set('Cookie', [`ysxflow_rt=${refreshToken}`]);
    expect(before.status).toBe(200);

    const logout = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(200);
    expect(logout.body.ok).toBe(true);

    // Same refresh token, minted against the pre-logout tokenVersion, is now revoked.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', [`ysxflow_rt=${refreshToken}`]);
    expect(after.status).toBe(401);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/auth/logout-all');
    expect(res.status).toBe(401);
  });
});

describe('change-password', () => {
  const email = 'change-password@example.com';
  const password = 'original-pass-1';

  it('rejects a wrong current password with 401', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email, password });
    const { accessToken } = signup.body;

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'not-the-password', newPassword: 'new-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a new password shorter than signup requires', async () => {
    const login = await request(app).post('/api/auth/login').send({ email, password });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: password, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('on success, evicts every other session but returns a fresh working pair', async () => {
    const login = await request(app).post('/api/auth/login').send({ email, password });
    const oldAccessToken = login.body.accessToken;
    const oldRefreshToken = refreshTokenFrom(login);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${oldAccessToken}`)
      .send({ currentPassword: password, newPassword: 'brand-new-pass-1' });
    expect(change.status).toBe(200);
    expect(change.body.accessToken).toBeTruthy();
    expect(change.body.refreshToken).toBeUndefined();
    expect(refreshCookie(change)).toMatch(/HttpOnly/i);

    // The old refresh token (pre-change tokenVersion) is now revoked.
    const oldRefresh = await request(app).post('/api/auth/refresh').set('Cookie', [`ysxflow_rt=${oldRefreshToken}`]);
    expect(oldRefresh.status).toBe(401);

    // The freshly issued pair from the change-password response still works.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${change.body.accessToken}`);
    expect(me.status).toBe(200);

    // New password now logs in; old password no longer does.
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'brand-new-pass-1' });
    expect(loginNew.status).toBe(200);

    const loginOld = await request(app).post('/api/auth/login').send({ email, password });
    expect(loginOld.status).toBe(401);
  });
});
