// FILE: server/src/__tests__/geminiProxy.test.ts
//
// The Gemini proxy's errors must be readable by the only client that calls it.
//
// The route answered `{ ok: false, error }`. services/gemini.ts reaches it
// through apiClient's apiRequest, whose parseError reads `data.code` and
// `data.message` and falls back to `res.statusText` when they are missing — so
// every diagnostic the route takes care to write ("Gemini is not configured on
// this server (GEMINI_API_KEY unset)", the upstream quota message, the
// blockReason) was discarded, and each AI feature failed with a bare "Not
// Implemented" / "Bad Gateway". The same value-nothing-reads shape this repo has
// now hit eight times.
//
// Mutation coverage, verified by performing the mutation: changing any of these
// responses back to `{ ok: false, error: … }` fails the matching test, because
// `code`/`message` go undefined.
//
// The router is mounted bare here rather than through the app: auth and the
// tenant gate sit in index.ts and are covered elsewhere: what is under test is
// the response shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import geminiRouter from '../gemini/routes.js';

const app = express();
app.use(express.json());
app.use('/api/gemini', geminiRouter);

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

describe('Gemini proxy error shape', () => {
  it('says WHY it is unconfigured, in the fields the client reads', async () => {
    delete process.env.GEMINI_API_KEY;

    const res = await request(app).post('/api/gemini/generate').send({ contents: 'hello' });

    expect(res.status).toBe(501);
    expect(res.body.code).toBe('NOT_CONFIGURED');
    expect(res.body.message).toMatch(/GEMINI_API_KEY/);
  });

  it('reports a missing prompt as a validation error', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const res = await request(app).post('/api/gemini/generate').send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toMatch(/contents/i);
  });

  it('passes an upstream quota error through as RATE_LIMIT with its message', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded for model' } }),
    } as any);

    const res = await request(app).post('/api/gemini/generate').send({ contents: 'hello' });

    // 429 passes through so the client can tell quota from bad input.
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMIT');
    expect(res.body.message).toBe('Quota exceeded for model');
  });

  it('explains an empty completion instead of returning a blank success', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    } as any);

    const res = await request(app).post('/api/gemini/generate').send({ contents: 'hello' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('EMPTY_RESPONSE');
    expect(res.body.message).toMatch(/SAFETY/);
  });

  it('still returns { text } on success', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'drafted reply' }] } }] }),
    } as any);

    const res = await request(app).post('/api/gemini/generate').send({ contents: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'drafted reply' });
  });
});
