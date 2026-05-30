
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSettings, FollowUpTone, SECRET_SETTING_KEYS } from '../types';

const STORAGE_KEY = 'ysxflow_settings';

// Matches the known secret keys plus any future key that looks like a
// credential (token/secret/password). Used to strip secrets before anything is
// written to localStorage so OAuth tokens / client secrets are never persisted.
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|pwd|apikey|api_key)/i;

function isSecretKey(key: string): boolean {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key) || SENSITIVE_KEY_RE.test(key);
}

/** Return a shallow copy of `obj` with all sensitive keys removed. */
export function stripSecrets<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isSecretKey(key)) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * Persist ONLY non-secret (public) settings to localStorage. Secrets
 * (access/refresh tokens, client secrets) are intentionally dropped and kept
 * in memory for the active session only.
 */
export function persistPublicSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripSecrets(settings)));
  } catch (e) {
    console.error('Failed to persist settings', e);
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  zohoClientId: '',
  zohoClientSecret: '',
  zohoRegion: 'US',
  defaultTone: FollowUpTone.PROFESSIONAL,
  emailSignature: 'John Doe',
  syncLookbackDays: 30,
  autoSync: true,
  useRealApi: false,
  transportMode: 'gateway-imap-smtp', // Default to Gateway
  activeProvider: 'ZOHO',
  zohoAccessToken: '',
  zohoRefreshToken: '',
  googleClientId: '',
  googleClientSecret: '',
  googleAccessToken: '',
  googleRefreshToken: ''
};

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  saveSettings: (newSettings: UserSettings) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Sanitize: never trust secrets that may exist in an older blob.
        const sanitized = stripSecrets(parsed);
        // Migration: if the stored blob contained secret keys, rewrite it clean
        // so the secrets are removed from disk immediately on first load.
        if (Object.keys(parsed).length !== Object.keys(sanitized).length) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
          } catch (e) {
            console.error('Failed to sanitize stored settings', e);
          }
        }
        // Secrets start empty each session (from DEFAULT_SETTINGS) and live in memory only.
        return { ...DEFAULT_SETTINGS, ...sanitized };
      }
    } catch (e) {
      console.error('Failed to parse saved settings', e);
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    // Persist public settings only; secrets are kept in memory for this session.
    persistPublicSettings(settings);
  }, [settings]);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const saveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
