/**
 * Portal API client — same refresh-and-retry pattern as the CRM's
 * services/apiClient.ts, but with its own localStorage key and the
 * /api/portal/auth/refresh endpoint, so a CRM admin session and a client
 * session can coexist in one browser without colliding.
 */

const STORAGE_KEY = 'ysx_client_auth';
const API_BASE = ''; // same-origin (served at /portal by the backend; dev proxies /api)

export interface PortalAuthState {
  accessToken: string;
  refreshToken: string;
  clientUser: { id: string; email: string };
  client: { id: string; name: string; companyName: string | null } | null;
}

export function loadAuth(): PortalAuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PortalAuthState) : null;
  } catch {
    return null;
  }
}

export function saveAuth(state: PortalAuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
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
      const auth = loadAuth();
      if (!auth?.refreshToken) return false;
      try {
        const res = await fetch(`${API_BASE}/api/portal/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        saveAuth({ ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken });
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
