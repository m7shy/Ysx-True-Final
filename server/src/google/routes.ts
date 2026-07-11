import express from 'express';
import { z } from 'zod';

import { logger } from '../logger.js';

const router = express.Router();

function isAllowedGmailApiEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);

    // Enforce HTTPS.
    if (url.protocol !== 'https:') return false;

    // Strict host allowlist to avoid SSRF.
    const allowedHosts = new Set(['gmail.googleapis.com', 'www.googleapis.com']);
    if (!allowedHosts.has(url.hostname)) return false;

    // Tighten path to Gmail API only.
    // Typical endpoints:
    // - https://gmail.googleapis.com/gmail/v1/...
    // - https://www.googleapis.com/gmail/v1/...
    if (!url.pathname.startsWith('/gmail/')) return false;

    return true;
  } catch {
    return false;
  }
}

router.post('/gmail', async (req, res) => {
  const schema = z.object({
    accessToken: z.string().min(1).optional().nullable(),
    endpoint: z.string().min(1),
    method: z.string().optional().default('GET'),
    body: z.any().optional(),
  });

  try {
    const parsed = schema.parse(req.body);

    if (!isAllowedGmailApiEndpoint(parsed.endpoint)) {
      return res.status(400).json({ error: 'Invalid or disallowed Google endpoint.' });
    }

    const method = parsed.method.toUpperCase();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (parsed.accessToken) {
      headers.Authorization = `Bearer ${parsed.accessToken}`;
    }

    const hasBody = parsed.body !== undefined && method !== 'GET' && method !== 'HEAD';
    let body: string | undefined;

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(parsed.body);
    }

    logger.debug({ method, host: new URL(parsed.endpoint).hostname, path: new URL(parsed.endpoint).pathname }, 'Proxying Google Gmail API request');

    const upstream = await fetch(parsed.endpoint, {
      method,
      headers,
      body,
    });

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader('content-type', contentType);

    // Preserve upstream JSON/text as-is.
    return res.send(text);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Google Gmail proxy failed');
    return res.status(500).json({ error: err?.message || 'Proxy error' });
  }
});

router.post('/oauth/token', async (req, res) => {
  // Google OAuth token endpoint expects application/x-www-form-urlencoded
  const tokenSchema = z.record(z.string(), z.string());

  try {
    const body = tokenSchema.parse(req.body);

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      params.set(k, v);
    }

    const upstream = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader('content-type', contentType);
    return res.send(text);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Google OAuth token proxy failed');
    return res.status(500).json({ error: err?.message || 'Proxy error' });
  }
});

export default router;
