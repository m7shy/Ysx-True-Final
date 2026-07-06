import { randomInt } from 'node:crypto';

/**
 * Spintax resolution: `{Hi|Hey|Hello} there` picks one alternative at random.
 * Supports nesting (`{A|{B|C}}`) by resolving innermost groups first.
 * A brace group with no `|` (e.g. a `{placeholder}`) is left untouched.
 */
const INNERMOST_GROUP = /\{([^{}]*)\}/;

// Sentinels used to mask non-spintax brace pairs so the scanner doesn't
// re-match them; restored to `{`/`}` at the end. Control characters never
// occur in email copy.
const L = String.fromCharCode(1);
const R = String.fromCharCode(2);

export function resolveSpintax(text: string): string {
  let out = text;
  // Each iteration removes one brace pair; the guard stops pathological
  // (unbalanced/huge) input from spinning forever.
  for (let i = 0; i < 1000; i++) {
    const match = INNERMOST_GROUP.exec(out);
    if (!match) break;
    const inner = match[1];
    let replacement: string;
    if (inner.includes('|')) {
      const options = inner.split('|');
      replacement = options[randomInt(options.length)];
    } else {
      replacement = L + inner + R;
    }
    out = out.slice(0, match.index) + replacement + out.slice(match.index + match[0].length);
  }
  return out.replaceAll(L, '{').replaceAll(R, '}');
}
