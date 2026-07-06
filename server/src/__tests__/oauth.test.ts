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
    user: { findUnique: async () => null },
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

  it('exchanges the code and upserts the mailbox for a valid state', async () => {
    const state = signOAuthState({ userId: 'u1', provider: 'gmail', nonce: 'n1' });
    const res = await request(app)
      .get('/api/auth/oauth/gmail/callback')
      .query({ code: 'auth-code', state });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('connected')).toBe('gmail');
    expect(location.searchParams.get('email')).toBe('connected@example.com');

    const call = upsertCalls.at(-1);
    expect(call.where).toEqual({ userId_email: { userId: 'u1', email: 'connected@example.com' } });
    // Tokens are encrypted before the DB write (never stored in plaintext).
    expect(call.create.accessToken).not.toBe('access-abc');
    expect(call.create.accessToken).toMatch(/^v1:/);
    expect(call.create.refreshToken).toMatch(/^v1:/);
  });

  it('passes provider errors (denied consent) back to the SPA', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/microsoft/callback')
      .query({ error: 'access_denied', error_description: 'user cancelled' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('oauth_error')).toBe('user cancelled');
  });
});
