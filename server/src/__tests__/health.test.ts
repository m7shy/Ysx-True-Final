
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('Health', () => {
  it('GET /api/health should return 200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ ok: true }));
  });
});
