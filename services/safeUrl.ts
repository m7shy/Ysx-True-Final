/**
 * Render-time guard for URLs that came from the database.
 *
 * File-link URLs are validated on write (server/src/projects/routes.ts restricts
 * the scheme to http/https), and that is the primary defence. This exists so the
 * guarantee does not rest solely on every current and future write path using
 * that one Zod schema: a `javascript:` or `data:` URL reaching an <a href> is
 * stored XSS, and in the client portal it is tenant→client XSS, not self-XSS.
 *
 * Returns undefined for anything that is not plain http/https, so callers can
 * render the link inert rather than dangerous.
 */
export function safeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    // Relative or malformed: not something we should emit into an href.
    return undefined;
  }
}
