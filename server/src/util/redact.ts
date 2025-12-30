
const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'auth',
  'authorization',
  'clientSecret',
  'client_secret',
  'accessToken'
]);

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
      if (SENSITIVE_KEYS.has(key)) {
        copy[key] = '[REDACTED]';
      } else {
        copy[key] = redactAuth(copy[key]);
      }
    }
  }
  return copy;
}
