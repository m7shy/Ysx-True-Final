
import { logger } from '../logger.js';

interface BackoffOptions {
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {}
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 300;
  const maxMs = opts.maxMs ?? 3000;
  const jitter = opts.jitter ?? true;

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= tries) {
        throw error;
      }

      // Calculate exponential backoff
      let delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      
      // Apply decorrelated jitter
      if (jitter) {
        delay = delay * (0.5 + Math.random());
      }

      logger.warn(
        { 
          error: error.message || String(error), 
          attempt, 
          nextDelay: Math.round(delay) 
        }, 
        'Operation failed, retrying...'
      );
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
