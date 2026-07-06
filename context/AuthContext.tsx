import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiRequest, ApiError } from '../services/apiClient';
import { loadAuth, saveAuth, clearAuth, StoredAuthUser } from '../services/authStorage';

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
  const [user, setUser] = useState<StoredAuthUser | null>(() => loadAuth()?.user ?? null);
  const [isHydrating, setIsHydrating] = useState(true);

  // Validate the stored access token (and silently refresh it if needed) once on load.
  useEffect(() => {
    const stored = loadAuth();
    if (!stored) {
      setIsHydrating(false);
      return;
    }

    apiRequest('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setIsHydrating(false));
  }, []);

  const authenticate = async (path: 'signup' | 'login', email: string, password: string) => {
    const data = await apiRequest(`/api/auth/${path}`, {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    });
    saveAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    setUser(data.user);
  };

  const login = (email: string, password: string) => authenticate('login', email, password);
  const signup = (email: string, password: string) => authenticate('signup', email, password);

  const logout = () => {
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
