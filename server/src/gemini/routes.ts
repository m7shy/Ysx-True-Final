import { Router, Request, Response } from 'express';

import { logger } from '../logger.js';

/**
 * Server-side Gemini proxy — the only path the frontend uses for AI features
 * (follow-up drafts, spam check, brand bible, story ideas, lead analysis).
 * Mounted behind requireAuth + requireActiveTenant in index.ts, so the API
 * key never reaches the browser and only paying tenants can spend quota.
 *
 * Contract with services/gemini.ts:
 *   POST /api/gemini/generate { model, contents, config } → { text }
 * `contents` is a plain prompt string; `config` carries responseMimeType /
 * responseSchema in the REST API's own shape (uppercase Type enums), so it
 * maps 1:1 onto generationConfig.
 */

const router = Router();

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

/** Only allow real Gemini model ids (prevents path traversal via `model`). */
function safeModel(raw: unknown): string | null {
  const m = typeof raw === 'string' ? raw.trim() : '';
  return /^gemini-[a-z0-9.-]+$/i.test(m) ? m : null;
}

/** Normalize the frontend's prompt (string or REST contents array). */
function toContents(raw: unknown): unknown[] | null {
  if (typeof raw === 'string' && raw.trim()) {
    return [{ parts: [{ text: raw }] }];
  }
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return null;
}

router.post('/generate', async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(501).json({ ok: false, error: 'Gemini is not configured on this server (GEMINI_API_KEY unset).' });
    return;
  }

  const body: any = req.body ?? {};
  const model = safeModel(body.model) ?? 'gemini-2.5-flash';
  const contents = toContents(body.contents);
  if (!contents) {
    res.status(400).json({ ok: false, error: 'contents (prompt) is required' });
    return;
  }

  const payload: Record<string, unknown> = { contents };
  if (body.config && typeof body.config === 'object') {
    payload.generationConfig = body.config;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data: any = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message = data?.error?.message ?? `Gemini upstream error (${upstream.status})`;
      logger.error({ status: upstream.status, message, model }, 'Gemini proxy upstream error');
      // 429/5xx pass through so the client can distinguish quota from bad input.
      const status = upstream.status === 429 || upstream.status >= 500 ? upstream.status : 502;
      res.status(status).json({ ok: false, error: message });
      return;
    }

    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'empty response';
      res.status(502).json({ ok: false, error: `Gemini returned no text (${reason})` });
      return;
    }

    res.json({ text });
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    logger.error({ err, model }, 'Gemini proxy request failed');
    res.status(aborted ? 504 : 502).json({
      ok: false,
      error: aborted ? 'Gemini request timed out' : 'Failed to reach Gemini',
    });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
