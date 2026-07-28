/**
 * Portal API client — same refresh-and-retry pattern as the CRM's
 * services/apiClient.ts, against /api/portal/auth/refresh.
 *
 * The refresh token is NOT held here: the server sets it as an HttpOnly cookie
 * (ysxportal_rt, scoped to the refresh path) which script cannot read, so an
 * XSS can act during its execution window but cannot exfiltrate a durable
 * credential. The access token is kept in memory only — deliberately not in
 * localStorage — which is why bootstrapSession() below must run on startup to
 * re-mint one from the cookie after a page reload.
 *
 * The CRM uses a different cookie name, so an admin session and a client
 * session still coexist in one browser exactly as the two localStorage keys
 * used to allow.
 */

const LEGACY_STORAGE_KEY = 'ysx_client_auth';
const API_BASE = ''; // same-origin (served at /portal by the backend; dev proxies /api)

export interface PortalAuthState {
  accessToken: string;
  clientUser: { id: string; email: string };
  client: { id: string; name: string; companyName: string | null } | null;
}

// In-memory only. Lost on reload by design — bootstrapSession() restores it.
let authState: PortalAuthState | null = null;

/**
 * Subscribers notified whenever the session appears or disappears.
 *
 * This exists because `authState` is plain module state: React had no way to
 * learn it had changed. `App.tsx` computed `authed` during render, so when a
 * mid-session refresh failed and `clearAuth()` ran, nothing re-rendered — the
 * client stayed on the shell with a dead UI instead of being sent to /login,
 * and only a manual reload got them out. A fresh load was fine (bootstrap runs
 * before the first render), so this only ever bit an already-open tab — which
 * is exactly what a deploy produces, since refresh-token rotation invalidates
 * every existing session at once.
 */
const authListeners = new Set<() => void>();

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onAuthChange(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function emitAuthChange(): void {
  // A throwing subscriber must not stop the others from being told, and must
  // never take down the caller — this runs inside request error handling.
  for (const listener of authListeners) {
    try {
      listener();
    } catch {
      /* a broken subscriber is not the session's problem */
    }
  }
}

export function loadAuth(): PortalAuthState | null {
  return authState;
}

/** Stable snapshot for useSyncExternalStore — a primitive, so identity is safe. */
export function isAuthed(): boolean {
  return authState !== null;
}

export function saveAuth(state: PortalAuthState): void {
  const had = authState !== null;
  authState = state;
  if (!had) emitAuthChange();
}

export function clearAuth(): void {
  const had = authState !== null;
  authState = null;
  if (had) emitAuthChange();
}

/**
 * Sign out properly: drop in-memory state AND ask the server to clear the
 * HttpOnly refresh cookie.
 *
 * clearAuth() alone is not a sign-out. The refresh token lives in an HttpOnly
 * cookie that script cannot touch, so clearing memory left the session fully
 * restorable — the next page load ran bootstrapSession() and signed the visitor
 * back in. On a shared computer that meant the next person became the previous
 * user. Errors are ignored on purpose: local state must be cleared even if the
 * network call fails, and the caller navigates away regardless.
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/portal/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    /* offline or server unreachable — still clear local state below */
  }
  clearAuth();
}

/**
 * Drop the pre-cookie localStorage blob. It held an access token AND a
 * long-lived refresh token in script-readable storage; nothing reads it now,
 * so leaving it behind would preserve exactly the exposure this migration
 * removes.
 */
export function purgeLegacyAuthStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

/**
 * Startup re-auth. The access token lives in memory, so a reload always starts
 * signed out; the refresh cookie is what actually carries the session. Returns
 * true when a session was restored. Callers must await this before deciding to
 * show the login screen, or every reload logs the client out.
 */
export async function bootstrapSession(): Promise<boolean> {
  purgeLegacyAuthStorage();
  return refreshTokens();
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        // No body: the refresh token rides along as the HttpOnly cookie, which
        // requires credentials: 'include'. The response carries the new access
        // token plus the identity payload, and re-sets the rotated cookie.
        const res = await fetch(`${API_BASE}/api/portal/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (!res.ok) return false;
        const data = await res.json();
        saveAuth({
          accessToken: data.accessToken,
          clientUser: data.clientUser,
          client: data.client,
        });
        return true;
      } catch {
        return false;
      } finally {
        // Let concurrent 401s share this attempt, then allow a fresh one.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; skipAuthRetry?: boolean } = {}
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const auth = loadAuth();
    return fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
      },
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  let res = await doFetch();

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearAuth();
    }
  }

  if (!res.ok) {
    let code = 'ERROR';
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      code = data.code ?? code;
      message = data.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }

  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => apiRequest<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, { method: 'POST', body });
