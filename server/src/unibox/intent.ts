import { logger } from '../logger.js';

/**
 * Lightweight AI intent categorization for inbound replies (Unibox).
 *
 * Uses Gemini (the project's existing AI provider — see gemini/routes.ts) via
 * the REST generateContent endpoint when GEMINI_API_KEY is set; otherwise (or
 * on any API failure) falls back to a keyword heuristic so reply handling
 * never blocks on the AI service.
 */

export type ReplyIntent =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'OUT_OF_OFFICE'
  | 'NEUTRAL';

const INTENTS: ReplyIntent[] = ['INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'NEUTRAL'];

const GEMINI_MODEL = process.env.GEMINI_INTENT_MODEL ?? 'gemini-2.0-flash';

const PROMPT_PREFIX =
  'You classify replies to cold outreach emails. Respond with exactly one word from: ' +
  'INTERESTED, NOT_INTERESTED, OUT_OF_OFFICE, NEUTRAL.\n' +
  'INTERESTED = wants to learn more, book a call, or asks questions about the offer.\n' +
  'NOT_INTERESTED = declines, unsubscribes, or asks to stop emailing.\n' +
  'OUT_OF_OFFICE = automatic away/vacation responder.\n' +
  'NEUTRAL = anything else.\n\nReply:\n';

export function classifyReplyIntentHeuristic(text: string): ReplyIntent {
  const t = text.toLowerCase();
  if (/(out of (the )?office|on vacation|annual leave|auto-?reply|automatic reply|away from|maternity|paternity|return(ing)? on)/.test(t)) {
    return 'OUT_OF_OFFICE';
  }
  if (/(not interested|no thanks|unsubscribe|remove me|stop (emailing|contacting)|don'?t contact|no longer interested)/.test(t)) {
    return 'NOT_INTERESTED';
  }
  if (/(interested|tell me more|more info|sounds (good|great)|book a (call|demo|meeting)|schedule|let'?s (talk|chat)|pricing|how much|send (me )?(the )?details)/.test(t)) {
    return 'INTERESTED';
  }
  return 'NEUTRAL';
}

export async function classifyReplyIntent(text: string): Promise<ReplyIntent> {
  const apiKey = process.env.GEMINI_API_KEY;
  const snippet = text.slice(0, 2000); // lightweight: a reply's intent is in its opening
  if (!apiKey) return classifyReplyIntentHeuristic(snippet);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT_PREFIX + snippet }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new Error(`Gemini responded ${res.status}`);
    const data: any = await res.json();
    const word = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
      .trim()
      .toUpperCase();
    const match = INTENTS.find((i) => word.includes(i));
    if (match) return match;
    throw new Error(`Unrecognized intent label: ${word || '(empty)'}`);
  } catch (err) {
    logger.warn({ err }, 'Gemini intent classification failed; using keyword heuristic');
    return classifyReplyIntentHeuristic(snippet);
  }
}
