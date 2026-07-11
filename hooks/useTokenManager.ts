import { useCallback } from 'react';
import { AppError, AppErrorCode, type UserSettings } from '../types';
import { useSettings } from '../context/SettingsContext';
import { refreshGoogleToken } from '../services/realGoogle';
import { refreshZohoToken } from '../services/realZoho';

type UiProvider = 'GMAIL' | 'ZOHO' | 'MICROSOFT';

interface TokenManagerResult {
  getValidToken: (provider: UiProvider) => Promise<string>;
  clearToken: (provider: UiProvider) => void;
}

/**
 * Centralizes access/refresh token handling for email providers.
 *
 * - Reuses existing access tokens when present
 * - Uses stored refresh tokens + client credentials to obtain new access tokens
 * - Persists updated access tokens back into UserSettings
 * - Exposes clearToken for when we detect an auth error and want to force re-auth
 */
export function useTokenManager(settings: UserSettings): TokenManagerResult {
  const { updateSettings } = useSettings();

  const getValidToken = useCallback(
    async (provider: UiProvider): Promise<string> => {
      if (provider === 'GMAIL') {
        // If we already have a Google access token, reuse it
        if (settings.googleAccessToken) {
          return settings.googleAccessToken;
        }

        const { googleClientId, googleClientSecret, googleRefreshToken } = settings;
        if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
          throw new AppError(
            AppErrorCode.AUTH_ERROR,
            'GOOGLE',
            'Google OAuth credentials are missing. Please connect your Google account in Settings.',
          );
        }

        const newToken = await refreshGoogleToken(
          googleClientId,
          googleClientSecret,
          googleRefreshToken,
        );
        // Persist for future calls
        updateSettings({ googleAccessToken: newToken });
        return newToken;
      }

      if (provider === 'ZOHO') {
        // If we already have a Zoho access token, reuse it
        if (settings.zohoAccessToken) {
          return settings.zohoAccessToken;
        }

        const { zohoRegion, zohoClientId, zohoClientSecret, zohoRefreshToken } = settings;
        if (!zohoRegion || !zohoClientId || !zohoClientSecret || !zohoRefreshToken) {
          throw new AppError(
            AppErrorCode.AUTH_ERROR,
            'ZOHO',
            'Zoho OAuth credentials are missing. Please connect your Zoho account in Settings.',
          );
        }

        const newToken = await refreshZohoToken(
          zohoRegion,
          zohoClientId,
          zohoClientSecret,
          zohoRefreshToken,
        );
        updateSettings({ zohoAccessToken: newToken });
        return newToken;
      }

      // Microsoft direct API token handling is not wired up yet in this app.
      // For now, surface a clear, typed error instead of silently failing.
      throw new AppError(
        AppErrorCode.AUTH_ERROR,
        'MICROSOFT',
        'Microsoft token management is not implemented yet in this client.',
      );
    },
    [settings, updateSettings],
  );

  const clearToken = useCallback(
    (provider: UiProvider) => {
      if (provider === 'GMAIL') {
        updateSettings({
          googleAccessToken: '',
          googleRefreshToken: '',
        });
      } else if (provider === 'ZOHO') {
        updateSettings({
          zohoAccessToken: '',
          zohoRefreshToken: '',
        });
      } else if (provider === 'MICROSOFT') {
        // Nothing to clear currently, but keep branch for future use
      }
    },
    [updateSettings],
  );

  return { getValidToken, clearToken };
}
