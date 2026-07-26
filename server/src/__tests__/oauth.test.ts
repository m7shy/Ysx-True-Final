import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// App-level OAuth client config + an encryption key so upsertMailbox can encrypt.
// Set via vi.hoisted so these land in process.env BEFORE config.ts is imported
// (config.ts parses WEB_ORIGIN / OAUTH_REDIRECT_BASE_URL once, at import time).
vi.hoisted(() => {
  process.env.GMAIL_OAUTH_CLIENT_ID = 'test-google-client-id';
  process.env.GMAIL_OAUTH_CLIENT_SECRET = 'test-google-secret';
  process.env.MAILBOX_ENCRYPTION_KEY = '0'.repeat(64);
  process.env.WEB_ORIGIN = 'http://localhost:5173';
  process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:3001';
});

// Capture mailbox writes without a real database.
const upsertCalls: any[] = [];
vi.mock('../db/prisma.js', () => ({
  prisma: {
    // /start now enforces the billing/status gate itself (connecting a mailbox
    // is a mutation despite the GET), so this must resolve to an active tenant.
    user: { findUnique: async () => ({ status: 'ACTIVE', tokenVersion: 0 }) },
    mailbox: {
      findMany: async () => [],
      findFirst: async () => null,
      upsert: async ({ where, create, update }: any) => {
        upsertCalls.push({ where, create, update });
        return { id: 'mb1', ...create };
      },
    },
  },
}));

// Stub the provider token exchange so the callback makes no network call. The
// fake id_token carries the connected mailbox address the route decodes.
vi.mock('../creds/oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../creds/oauth.js')>();
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = `${b64({ alg: 'none' })}.${b64({ email: 'connected@example.com' })}.`;
  return {
    ...actual,
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: 'access-abc',
      refreshToken: 'refresh-xyz',
      idToken,
      expiresAt: new Date(Date.now() + 3600_000),
      scope: 'https://mail.google.com/ openid email',
    })),
  };
});

import { app } from '../index.js';
import { signAccessToken, signOAuthState } from '../auth/jwt.js';

describe('OAuth connect flow', () => {
  it('rejects an unauthenticated /start (cannot mint a state without auth)', async () => {
    const res = await request(app).get('/api/auth/oauth/gmail/start');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH');
  });

  it('returns a Google authorize URL for an authenticated /start', async () => {
    const token = signAccessToken({ userId: 'u1', email: 'u1@example.com' });
    const res = await request(app)
      .get('/api/auth/oauth/gmail/start')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const url = new URL(res.body.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/oauth/gmail/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('rejects an unknown provider on /start', async () => {
    const token = signAccessToken({ userId: 'u1', email: 'u1@example.com' });
    const res = await request(app)
      .get('/api/auth/oauth/pigeonmail/start')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROVIDER');
  });

  it('refuses a callback without a valid state and writes nothing', async () => {
    const before = upsertCalls.length;
    const res = await request(app)
      .get('/api/auth/oauth/gmail/callback')
      .query({ code: 'auth-code', state: 'forged-or-missing-signature' });

    // Bounced back to the SPA with an error; no mailbox persisted.
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error');
    expect(upsertCalls.length).toBe(before);
  });

  // ── The attack this binding exists to stop ────────────────────────────────
  // An attacker calls /start on their OWN account, gets a perfectly valid
  // signed state, and phishes a victim with that authorize URL. The victim
  // consents with their own mailbox. Without browser binding the callback sees
  // a valid signature plus the attacker's `sub` and hands the VICTIM'S mailbox
  // tokens to the ATTACKER'S tenant. The victim's browser has no binding
  // cookie, so the redemption must fail.
  it('refuses a validly-signed state redeemed from a different browser (no binding cookie)', async () => {
    const before = upsertCalls.length;
    const attackerSecret = 'attacker-binding-secret';
    const state = signOAuthState({
      userId: 'attacker',
      provider: 'gmail',
      bnd: createHash('sha256').update(attackerSecret).digest('hex'),
    });

    // Victim's browser: valid state in the URL, but no cookie.
    const res = await request(app)
      .get('/api/auth/oauth/gmail/callback')
      .query({ code: 'auth-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error');
    // The critical assertion: no mailbox was attached to anyone.
    expect(upsertCalls.length).toBe(before);
  });

  it('refuses a state whose binding cookie does not match', async () => {
    const before = upsertCalls.length;
    const state = signOAuthState({
      userId: 'u1',
      provider: 'gmail',
      bnd: createHash('sha256').update('the-real-secret').digest('hex'),
    });

    const res = await request(app)
      .get('/api/auth/oauth/gmail/callback')
      .set('Cookie', ['ysx_oauth_state=a-different-secret'])
      .query({ code: 'auth-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error');
    expect(upsertCalls.length).toBe(before);
  });

  it('exchanges the code and upserts the mailbox for a valid, browser-bound state', async () => {
    const secret = 'binding-secret-value';
    const bnd = createHash('sha256').update(secret).digest('hex');
    const state = signOAuthState({ userId: 'u1', provider: 'gmail', bnd });
    const res = await request(app)
      .get('/api/auth/oauth/gmail/callback')
      .set('Cookie', [`ysx_oauth_state=${secret}`])
      .query({ code: 'auth-code', state });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('connected')).toBe('gmail');
    // The mailbox address is deliberately no longer echoed into the redirect —
    // it would persist in browser history and Referer headers.
    expect(location.searchParams.get('email')).toBeNull();

    const call = upsertCalls.at(-1);
    expect(call.where).toEqual({ userId_email: { userId: 'u1', email: 'connected@example.com' } });
    // Tokens are encrypted before the DB write (never stored in plaintext).
    expect(call.create.accessToken).not.toBe('access-abc');
    expect(call.create.accessToken).toMatch(/^v1:/);
    expect(call.create.refreshToken).toMatch(/^v1:/);
  });

  it('maps provider errors to a fixed message instead of reflecting the raw text', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/microsoft/callback')
      .query({ error: 'access_denied', error_description: '<img src=x onerror=alert(1)> user cancelled' });
    expect(res.status).toBe(302);
    const reflected = new URL(res.headers.location).searchParams.get('oauth_error');
    // A recognised code still yields a useful, human-readable message...
    expect(reflected).toBe('You declined the connection request.');
    // ...but nothing the provider supplied reaches the browser's address bar,
    // history, or the SPA's Referer headers.
    expect(reflected).not.toContain('onerror');
    expect(reflected).not.toContain('user cancelled');
  });
});
