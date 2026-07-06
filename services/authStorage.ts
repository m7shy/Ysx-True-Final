// Plain (non-React) JWT token storage so both the AuthContext and non-hook
// service modules (mailGateway, apiClient) can read/write the same session.

export interface StoredAuthUser {
  id: string;
  email: string;
}

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: StoredAuthUser;
}

const STORAGE_KEY = 'ysxflow_auth';

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed as StoredAuth;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAccessToken(): string | null {
  return loadAuth()?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return loadAuth()?.refreshToken ?? null;
}
