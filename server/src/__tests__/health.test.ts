
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Configure a health token BEFORE index.js/config.ts are imported — config
// parses env once at import time.
const { HEALTH_TOKEN } = vi.hoisted(() => {
  const token = 'test-health-token-0123456789';
  process.env.HEALTH_TOKEN = token;
  return { HEALTH_TOKEN: token };
});

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';

describe('Health', () => {
  it('GET /api/health should return 200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ ok: true }));
  });
});

describe('deep health auth (HEALTH_TOKEN configured)', () => {
  // Configuring a token for an uptime monitor used to lock admins out of their
  // own diagnostics: the guard returned early whenever HEALTH_TOKEN was set, so
  // the requireAuth fallback became unreachable. Both callers must work, and
  // neither path may be anonymous.
  it('refuses an anonymous request', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const res = await request(app).get('/api/health/deep').set('X-Health-Token', 'not-the-token');
    expect(res.status).toBe(401);
  });

  // A correct token must get PAST the auth gate. The payload itself needs a
  // database, so this asserts only that it is no longer rejected as
  // unauthorized — that is the property the guard owns.
  it('accepts a correct token', async () => {
    const res = await request(app).get('/api/health/deep').set('X-Health-Token', HEALTH_TOKEN);
    expect(res.status).not.toBe(401);
  });

  // THE regression this guard exists to prevent: an admin with a normal
  // session, no health token, while HEALTH_TOKEN is configured. The old code
  // returned early on the token branch, so requireAuth was unreachable and the
  // admin was locked out of the diagnostics page.
  // Signed without a tokenVersion claim so requireAuth needs no DB lookup.
  it('accepts a normal admin session even though a token is configured', async () => {
    const bearer = signAccessToken({ userId: 'admin1', email: 'admin@example.com' });
    const res = await request(app).get('/api/health/deep').set('Authorization', `Bearer ${bearer}`);
    expect(res.status).not.toBe(401);
  });
});
