import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { classifyReplyIntent, classifyReplyIntentHeuristic } from '../unibox/intent.js';

/**
 * Reply-intent label parsing.
 *
 * The bug these guard: the model's answer was matched with
 * `INTENTS.find((i) => word.includes(i))`, and 'INTERESTED' is the first entry
 * — so 'NOT_INTERESTED'.includes('INTERESTED') matched, and every correctly
 * classified opt-out came back as INTERESTED. Someone replying "please stop
 * emailing me" was filed as a warm prospect.
 */

const REAL_FETCH = globalThis.fetch;

function mockGeminiSaying(label: string) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: label }] } }] }),
  })) as any;
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.GEMINI_API_KEY;
});

describe('classifyReplyIntent label parsing', () => {
  it('reads NOT_INTERESTED as NOT_INTERESTED, not INTERESTED', async () => {
    mockGeminiSaying('NOT_INTERESTED');
    expect(await classifyReplyIntent('please stop emailing me')).toBe('NOT_INTERESTED');
  });

  it('still reads a plain INTERESTED correctly', async () => {
    mockGeminiSaying('INTERESTED');
    expect(await classifyReplyIntent('sounds great, send details')).toBe('INTERESTED');
  });

  it('handles the label wrapped in punctuation or a sentence', async () => {
    mockGeminiSaying('  "NOT_INTERESTED".  ');
    expect(await classifyReplyIntent('remove me')).toBe('NOT_INTERESTED');
  });

  it('reads the remaining labels', async () => {
    mockGeminiSaying('OUT_OF_OFFICE');
    expect(await classifyReplyIntent('I am on annual leave')).toBe('OUT_OF_OFFICE');
    mockGeminiSaying('NEUTRAL');
    expect(await classifyReplyIntent('thanks')).toBe('NEUTRAL');
  });

  it('falls back to the keyword heuristic on an unrecognised label', async () => {
    mockGeminiSaying('MAYBE_LATER');
    // The heuristic, not the broken parse, decides — and it reads this as an
    // opt-out.
    expect(await classifyReplyIntent('please unsubscribe me')).toBe('NOT_INTERESTED');
  });
});

describe('keyword heuristic (the no-API-key path)', () => {
  it('classifies an explicit opt-out as NOT_INTERESTED', () => {
    expect(classifyReplyIntentHeuristic('please remove me from your list')).toBe('NOT_INTERESTED');
    expect(classifyReplyIntentHeuristic('not interested, thanks')).toBe('NOT_INTERESTED');
  });

  it('checks out-of-office before interest, so an autoreply is not a lead', () => {
    expect(classifyReplyIntentHeuristic('Automatic reply: I am out of the office until Monday')).toBe(
      'OUT_OF_OFFICE',
    );
  });
});
