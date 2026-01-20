import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to tokens.json: server/src/mail/ -> server/data/tokens.json
const TOKENS_PATH = path.resolve(__dirname, '../../data/tokens.json');

interface TokenData {
  tenant: string;
  scope: string;
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  obtainedAt: number;
  expiresAt: number;
}

interface TokensFile {
  version: number;
  microsoft: Record<string, TokenData>;
}

function loadTokens(): TokensFile {
  if (!fs.existsSync(TOKENS_PATH)) {
    return { version: 1, microsoft: {} };
  }
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { version: 1, microsoft: {} };
  }
}

function saveTokens(data: TokensFile) {
  try {
    const dir = path.dirname(TOKENS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // ignore
  }
}

/**
 * Get a valid access token for the given Microsoft user.
 * Refreshes if expired.
 */
export async function getMicrosoftImapAccessToken(userEmail: string): Promise<string> {
  const emailKey = userEmail.toLowerCase().trim();
  const db = loadTokens();
  const tokenData = db.microsoft[emailKey];

  if (!tokenData) {
    const error: any = new Error(`No Microsoft OAuth tokens found for ${userEmail}. Please authenticate first.`);
    error.status = 401;
    error.code = 'AUTH';
    throw error;
  }

  // Check expiration (buffer of 5 minutes)
  const now = Date.now();
  if (tokenData.expiresAt > now + 5 * 60 * 1000) {
    return tokenData.accessToken;
  }

  // Refresh
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId) {
    throw new Error('Missing MICROSOFT_CLIENT_ID env var');
  }

  const tenant = tokenData.tenant || 'common';
  const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  // Ensure we have a valid scope. Use the stored one or a sensible default.
  const scope = tokenData.scope || 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';

  const doRefresh = async (secret?: string) => {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    if (secret) {
      params.append('client_secret', secret);
    }
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', tokenData.refreshToken);
    params.append('scope', scope);

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }

    return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
  };

  // 1. Try with secret if we have one
  let result = await doRefresh(clientSecret);

  // 2. If failed because of "Public client should not use secret" (AADSTS700025), retry without it
  if (!result.ok && clientSecret) {
    const errDesc = result.json?.error_description || result.text;
    if (errDesc.includes('AADSTS700025')) {
      result = await doRefresh(undefined);
    }
  }

  if (!result.ok) {
    const safeError = result.text.slice(0, 300);
    // Create an error that looks like an HttpError so routes.ts can handle it as 401
    const error: any = new Error(`Token refresh failed: ${result.status} ${result.statusText} - ${safeError}`);
    error.status = 401;
    error.code = 'AUTH';
    
    // Check if it's the public client error (AADSTS700025)
    if (safeError.includes('AADSTS700025')) {
       error.message = `Microsoft OAuth refresh failed. ${result.status} ${result.statusText} - ${safeError} Public client apps must not send client_secret. Either remove MICROSOFT_CLIENT_SECRET or use a confidential client app registration`;
    }
    
    throw error;
  }

  const json = result.json;
    
  // Update token data
  const expiresIn = json.expires_in; // seconds
  tokenData.accessToken = json.access_token;
  if (json.refresh_token) {
    tokenData.refreshToken = json.refresh_token;
  }
  tokenData.obtainedAt = Date.now();
  tokenData.expiresAt = Date.now() + (expiresIn * 1000);

  // Save back
  db.microsoft[emailKey] = tokenData;
  saveTokens(db);

  return tokenData.accessToken;
}