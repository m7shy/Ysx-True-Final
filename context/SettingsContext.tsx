
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSettings, FollowUpTone } from '../types';

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
    const saved = localStorage.getItem('ysxflow_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Persist tokens so the user stays logged in across reloads in this client-side app
        return { 
            ...DEFAULT_SETTINGS, 
            ...parsed
        };
      } catch (e) {
        console.error("Failed to parse saved settings", e);
      }
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    // Save all settings including tokens to localStorage to maintain session state
    localStorage.setItem('ysxflow_settings', JSON.stringify(settings));
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
