
// Substring match on a lowercased key rather than an exact-match allowlist.
// The previous exact set missed refreshToken, refresh_token, access_token,
// passwordHash, token, secret and apiKey, and was case-sensitive — so it
// redacted the short-lived `accessToken` while a `refreshToken` in the same
// object (a far more valuable, long-lived credential) went to disk in
// cleartext. A helper that is wrong in that direction is worse than none,
// because callers reasonably assume it covers credentials.
const SENSITIVE_KEY_PATTERNS = ['token', 'secret', 'password', 'passwd', 'pass', 'apikey', 'api_key', 'auth', 'credential', 'cookie'];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

export function maskEmail(user: string): string {
  if (!user || !user.includes('@')) return '****';
  const [name] = user.split('@');
  return `${name}@****`;
}

export function redactAuth<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactAuth) as unknown as T;
  }

  const copy = { ...obj } as any;
  for (const key in copy) {
    if (Object.prototype.hasOwnProperty.call(copy, key)) {
      if (isSensitiveKey(key)) {
        copy[key] = '[REDACTED]';
      } else {
        copy[key] = redactAuth(copy[key]);
      }
    }
  }
  return copy;
}
