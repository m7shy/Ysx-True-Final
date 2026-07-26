// In-memory JWT access-token store so both the AuthContext and non-hook
// service modules (mailGateway, apiClient) can read/write the same session.
//
// The refresh token is carried as an HttpOnly cookie — script never sees it,
// so we only hold the access token and the user profile, and only in memory.
// A page reload therefore starts signed out on purpose; AuthContext's
// boot-time silent refresh re-mints from the cookie.

export interface StoredAuthUser {
  id: string;
  email: string;
}

// ── Legacy localStorage cleanup ─────────────────────────────────────────────
// Before the cookie migration this key held both tokens plus the user profile.
// Clear it on load so a stale refresh token does not linger in script-readable
// storage — leaving it would preserve the exact exposure the migration removes.
const LEGACY_STORAGE_KEY = 'ysxflow_auth';
try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* SSR / test env */ }

// ── Session-cleared subscribers ─────────────────────────────────────────────
// Other per-tenant client-only state (SettingsContext's persisted settings,
// App.tsx's scraper poll state) must reset whenever the session is cleared —
// whether from an explicit logout or from apiClient giving up on a failed
// silent refresh mid-session. Rather than have every such module poke
// authStorage directly, they subscribe here and clearAuth() notifies them.
// Without this, on a shared browser the next tenant to log in inherited the
// previous tenant's leftover client-side state.
type SessionClearedListener = () => void;
const sessionClearedListeners = new Set<SessionClearedListener>();

export function onSessionCleared(listener: SessionClearedListener): () => void {
  sessionClearedListeners.add(listener);
  return () => {
    sessionClearedListeners.delete(listener);
  };
}

// ── Module-level in-memory state ────────────────────────────────────────────
let accessToken: string | null = null;
let user: StoredAuthUser | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Replace only the access token, leaving the stored profile intact. Used by the
 * refresh path: a refresh re-mints credentials for the SAME identity, and on
 * boot the profile is still null here until AuthContext loads /api/auth/me.
 */
export function setAccessToken(token: string): void {
  accessToken = token;
}

export function getUser(): StoredAuthUser | null {
  return user;
}

/** Store the access token and user after login/signup. */
export function saveAuth(auth: { accessToken: string; user: StoredAuthUser }): void {
  accessToken = auth.accessToken;
  user = auth.user;
}

/**
 * Current in-memory auth state, or null when signed out — including right
 * after a reload, before the boot-time silent refresh has completed.
 */
export function loadAuth(): { accessToken: string; user: StoredAuthUser } | null {
  if (!accessToken || !user) return null;
  return { accessToken, user };
}

export function clearAuth(): void {
  accessToken = null;
  user = null;
  sessionClearedListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // one listener's failure shouldn't block the others from resetting
    }
  });
}
