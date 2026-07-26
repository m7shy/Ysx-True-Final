// In-memory JWT access-token store so both the AuthContext and non-hook
// service modules (mailGateway, apiClient) can read/write the same session.
//
// The refresh token is now carried as an HttpOnly cookie — script never sees
// it, so we only hold the access token and the user profile in memory.

export interface StoredAuthUser {
  id: string;
  email: string;
}

// ── Legacy localStorage cleanup ─────────────────────────────────────────────
// The pre-cookie migration stored both tokens plus the user profile under this
// key. Clear it on load so a stale refresh token does not linger in storage.
const LEGACY_STORAGE_KEY = 'ysxflow_auth';
try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* SSR / test env */ }

// ── Module-level in-memory state ────────────────────────────────────────────
let accessToken: string | null = null;
let user: StoredAuthUser | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function getUser(): StoredAuthUser | null {
  return user;
}

/** Store the access token and user after login/signup/refresh. */
export function saveAuth(auth: { accessToken: string; user: StoredAuthUser }): void {
  accessToken = auth.accessToken;
  user = auth.user;
}

/**
 * Load the current in-memory auth state. Returns null if the user has not
 * logged in (or if the page was reloaded — the boot-time silent refresh in
 * AuthContext handles that case).
 */
export function loadAuth(): { accessToken: string; user: StoredAuthUser } | null {
  if (!accessToken || !user) return null;
  return { accessToken, user };
}

export function clearAuth(): void {
  accessToken = null;
  user = null;
}
