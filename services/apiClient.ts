import { getAccessToken, getRefreshToken, saveAuth, clearAuth, loadAuth } from './authStorage';

export const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let refreshPromise: Promise<boolean> | null = null;

/** Exchange the stored refresh token for a fresh pair. De-duplicated across concurrent 401s. */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    const current = loadAuth();
    if (!refreshToken || !current) return false;

    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      saveAuth({ ...current, accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    }
  })();

  const result = await refreshPromise;
  refreshPromise = null;
  return result;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    return new ApiError(res.status, data.code ?? 'UNKNOWN', data.message ?? res.statusText);
  } catch {
    return new ApiError(res.status, 'UNKNOWN', res.statusText);
  }
}

/**
 * Authenticated JSON request. On a 401 (other than the auth endpoints
 * themselves) it tries one silent token refresh, then retries once. If that
 * also fails, the stored session is cleared so the app falls back to the
 * login screen.
 */
export async function apiRequest<T = any>(
  path: string,
  options: { method?: string; body?: unknown; skipAuthRetry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, skipAuthRetry } = options;

  const doFetch = () => {
    const token = getAccessToken();
    return fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();

  if (res.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearAuth();
      throw new ApiError(401, 'AUTH', 'Session expired. Please log in again.');
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiGet = <T = any>(path: string) => apiRequest<T>(path);
export const apiPost = <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body });
export const apiPatch = <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body });
export const apiDelete = <T = any>(path: string) => apiRequest<T>(path, { method: 'DELETE' });
