
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSettings, DEFAULT_SETTINGS } from '../types';
import { onSessionCleared } from '../services/authStorage';

const DEFAULT_SETTINGS_LOCAL: UserSettings = {
  ...DEFAULT_SETTINGS,
  emailSignature: 'John Doe',
};

const SETTINGS_STORAGE_KEY = 'ysxflow_settings';

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  saveSettings: (newSettings: UserSettings) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Keys that existed before the browser-side 'oauth-api' transport was removed.
// They held the tenant's Google/Zoho OAuth client secrets, access tokens and
// refresh tokens in localStorage. Nothing reads them any more, but a returning
// user still has them persisted — so strip them on load rather than spreading
// them back into state and re-persisting them on the next write.
const REMOVED_SETTING_KEYS = [
  'zohoAccessToken',
  'zohoRefreshToken',
  'googleAccessToken',
  'googleRefreshToken',
  'zohoClientSecret',
  'googleClientSecret',
  'zohoClientId',
  'googleClientId',
  'zohoRegion',
] as const;

function migrateSaved(parsed: Record<string, unknown>): Partial<UserSettings> {
  const cleaned = { ...parsed };
  for (const key of REMOVED_SETTING_KEYS) delete cleaned[key];
  // 'oauth-api' is no longer a valid transport. Anyone with it persisted must
  // fall back to the gateway, which is now the only mode.
  if (cleaned.transportMode !== 'gateway-imap-smtp') delete cleaned.transportMode;
  return cleaned as Partial<UserSettings>;
}

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
            ...DEFAULT_SETTINGS_LOCAL,
            ...migrateSaved(parsed),
        };
      } catch (e) {
        console.error("Failed to parse saved settings", e);
      }
    }
    return DEFAULT_SETTINGS_LOCAL;
  });

  useEffect(() => {
    // Save all settings including tokens to localStorage to maintain session state
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // This holds OAuth access/refresh tokens and client secrets (SecureState in
  // types.ts) under one global, unscoped storage key — logging out never used
  // to clear it, so on a shared browser the next tenant to log in inherited
  // the previous tenant's mail-provider credentials straight from localStorage.
  // Reset on every session clear (explicit logout or a forced session expiry).
  useEffect(() => onSessionCleared(() => {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    setSettings(DEFAULT_SETTINGS_LOCAL);
  }), []);

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
