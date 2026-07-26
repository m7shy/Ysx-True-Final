import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiRequest, refreshAccessToken, ApiError } from '../services/apiClient';
import { saveAuth, clearAuth, onSessionCleared, StoredAuthUser } from '../services/authStorage';

interface AuthContextType {
  user: StoredAuthUser | null;
  isLoggedIn: boolean;
  isHydrating: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<StoredAuthUser | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  // On boot, perform silent re-auth using the HttpOnly refresh token cookie.
  useEffect(() => {
    refreshAccessToken()
      .then((success) => {
        if (!success) {
          clearAuth();
          setUser(null);
          return;
        }
        return apiRequest('/api/auth/me').then((data) => setUser(data.user));
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setIsHydrating(false));
  }, []);

  // apiClient clears storage directly (it's a plain module, not a hook) when
  // a mid-session 401 survives a silent refresh attempt — without this, the
  // `user` state here stays set and the app keeps rendering the authenticated
  // shell while every request now 401s, with no way back to the login screen
  // short of a manual reload.
  useEffect(() => onSessionCleared(() => setUser(null)), []);

  const authenticate = async (path: 'signup' | 'login', email: string, password: string) => {
    const data = await apiRequest(`/api/auth/${path}`, {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    });
    saveAuth({ accessToken: data.accessToken, user: data.user });
    setUser(data.user);
  };

  const login = (email: string, password: string) => authenticate('login', email, password);
  const signup = (email: string, password: string) => authenticate('signup', email, password);

  const logout = () => {
    apiRequest('/api/auth/logout', { method: 'POST', skipAuthRetry: true }).catch(() => {});
    clearAuth();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, isHydrating, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export { ApiError };
