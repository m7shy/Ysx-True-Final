
import { Email, EmailStatus, AppError, AppErrorCode } from '../types';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';
const PROXY_URL = `${API_URL}/api/zoho`;

// Base URL depends on region
const getApiBase = (region: string = 'US') => {
  switch (region) {
    case 'EU': return 'https://mail.zoho.eu/api';
    case 'IN': return 'https://mail.zoho.in/api';
    case 'AU': return 'https://mail.zoho.com.au/api';
    case 'CN': return 'https://mail.zoho.com.cn/api';
    default: return 'https://mail.zoho.com/api';
  }
};

const getOAuthBase = (region: string = 'US') => {
  switch (region) {
    case 'EU': return 'https://accounts.zoho.eu';
    case 'IN': return 'https://accounts.zoho.in';
    case 'AU': return 'https://accounts.zoho.com.au';
    case 'CN': return 'https://accounts.zoho.com.cn';
    default: return 'https://accounts.zoho.com';
  }
};

interface ZohoAccount {
  accountId: string;
  accountName: string;
  isPrimary: boolean;
  incomingUserName: string;
  emailAddress: string;
}

interface ZohoMessage {
  messageId: string;
  toAddress: string;
  subject: string;
  summary: string;
  sentDateInMillis: string | number;
}

// --- HELPERS ---

// robustly extract email from "Name <email>" format
const extractEmail = (raw: string): string => {
  if (!raw) return 'unknown@example.com';
  // Remove brackets and quotes
  let clean = raw.replace(/[<>"']/g, '').trim();
  
  // If string has spaces (e.g. "Name email@domain.com"), grab the last part
  const parts = clean.split(' ');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    if (lastPart.includes('@')) clean = lastPart;
  }
  return clean;
};

const safeDateConvert = (dateInput: string | number): string => {
  try {
    const num = Number(dateInput);
    if (!isNaN(num) && num > 0) return new Date(num).toISOString();
    return new Date().toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
};

const safeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // Extract info from arguments to forward to proxy
  const url = input.toString();
  const authHeader = (init?.headers as any)?.['Authorization'];
  const accessToken = authHeader ? authHeader.replace('Zoho-oauthtoken ', '') : null;
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  // We allow accessToken to be null for refresh token requests
  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        endpoint: url,
        method,
        body
      })
    });
    return response;
  } catch (error: any) {
    console.error("SafeFetch caught error:", error);
    throw new AppError(
      AppErrorCode.NETWORK_ERROR, 
      'ZOHO', 
      "Connection Blocked (CORS) or Proxy Error. Ensure your backend server is running."
    );
  }
};

const handleApiError = async (response: Response) => {
  if (!response.ok) {
    let errorDetail = "";
    try {
      const errorJson = await response.json();
      if (errorJson && typeof errorJson === 'object') {
         if (errorJson.status && errorJson.status.description) {
            errorDetail = errorJson.status.description;
         } else if (errorJson.data && errorJson.data.errorMessage) {
            errorDetail = errorJson.data.errorMessage;
         } else {
            errorDetail = JSON.stringify(errorJson);
         }
      }
    } catch (e) {
      errorDetail = await response.text();
    }

    if (response.status === 401) {
      throw new AppError(AppErrorCode.AUTH_EXPIRED, 'ZOHO', "Zoho Access Token Expired or Invalid. Please refresh your token in Settings.");
    }
    
    if (response.status === 429) {
      throw new AppError(AppErrorCode.RATE_LIMIT, 'ZOHO', "Zoho API Rate Limit Exceeded.");
    }
    
    throw new AppError(AppErrorCode.UNKNOWN, 'ZOHO', `Zoho API Error (${response.status}): ${errorDetail || response.statusText}`);
  }
  return response.json();
};

// --- CORE FUNCTIONS ---

export const refreshZohoToken = async (
  region: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> => {
  const baseUrl = getOAuthBase(region);
  // Zoho requires these as query params for POST
  const url = `${baseUrl}/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`;

  try {
    // We reuse the proxy but without an accessToken
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: url,
        method: 'POST'
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Refresh Failed: ${data.error}`);
    }

    if (!data.access_token) {
      throw new Error("No access_token returned from Zoho.");
    }

    return data.access_token;
  } catch (error: any) {
    console.error("Token Refresh Error:", error);
    throw new Error(error.message || "Failed to refresh token");
  }
};

export const getZohoAccountId = async (accessToken: string, region: string): Promise<string> => {
  const baseUrl = getApiBase(region);
  const response = await safeFetch(`${baseUrl}/accounts`, {
    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
  });
  
  const data = await handleApiError(response);
  
  if (data.data && data.data.length > 0) {
    const primary = data.data.find((acc: ZohoAccount) => acc.isPrimary) || data.data[0];
    return primary.accountId;
  }
  throw new AppError(AppErrorCode.NOT_FOUND, 'ZOHO', "No Zoho Mail accounts found.");
};

// Helper to get the sender email address (Required for sending)
const getFromAddress = async (accessToken: string, accountId: string, baseUrl: string): Promise<string> => {
  try {
    const response = await safeFetch(`${baseUrl}/accounts`, {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });
    const data = await response.json();
    const accounts = Array.isArray(data.data) ? data.data : [data.data];
    const account = accounts.find((acc: any) => acc.accountId === accountId);
    return account?.incomingUserName || account?.emailAddress || "";
  } catch (e) {
    console.warn("Failed to fetch From Address", e);
    return "";
  }
};

export const fetchRealSentEmails = async (accessToken: string, accountId: string, region: string): Promise<Email[]> => {
  const baseUrl = getApiBase(region);
  
  let folderId = null;

  // 1. Try to get Folder ID for 'Sent'
  try {
    const foldersRes = await safeFetch(`${baseUrl}/accounts/${accountId}/folders`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });
    const foldersData = await handleApiError(foldersRes);
    
    const sentFolder = foldersData.data.find((f: any) => 
      f.path.toLowerCase().includes('sent') || f.name.toLowerCase().includes('sent')
    );
    
    if (sentFolder) {
      folderId = sentFolder.folderId;
    }
  } catch (e: any) {
    if (e instanceof AppError && (e.code === AppErrorCode.AUTH_EXPIRED)) {
        throw e;
    }
    console.warn("Failed to fetch folders list, attempting search fallback.", e);
  }

  let url = '';
  if (folderId) {
     url = `${baseUrl}/accounts/${accountId}/messages/view?folderId=${folderId}&limit=20&sortorder=desc`;
  } else {
     url = `${baseUrl}/accounts/${accountId}/messages/search?searchKey=from:me&limit=20`;
  }

  // 2. Fetch Messages
  const response = await safeFetch(url, {
    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
  });
  
  const data = await handleApiError(response);
  
  if (!data.data) return [];

  // 3. Map to local Email type using robust parsing
  return data.data.map((msg: ZohoMessage) => ({
    id: msg.messageId,
    recipient: extractEmail(msg.toAddress),
    recipientName: (msg.toAddress || 'Unknown').split('<')[0].trim().replace(/"/g, ''),
    recipientEmail: extractEmail(msg.toAddress),
    company: 'External',
    subject: msg.subject || '(No Subject)',
    body: msg.summary || "Content not available",
    sentDate: safeDateConvert(msg.sentDateInMillis),
    status: EmailStatus.NO_REPLY
  }));
};

export const sendRealEmail = async (
  accessToken: string,
  accountId: string,
  region: string,
  to: string,
  subject: string,
  body: string
): Promise<void> => {
  const baseUrl = getApiBase(region);
  
  // 1. Fetch the sender address (Required by Zoho)
  const fromAddr = await getFromAddress(accessToken, accountId, baseUrl);
  
  const payload = {
    fromAddress: fromAddr,
    toAddress: extractEmail(to),
    subject: subject || "(No Subject)",
    content: body || " ",
    askReceipt: "false"
  };

  const response = await safeFetch(`${baseUrl}/accounts/${accountId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  await handleApiError(response);
};

export const scheduleRealEmail = async (
  accessToken: string,
  accountId: string,
  region: string,
  to: string,
  subject: string,
  body: string,
  scheduledTime: string
): Promise<void> => {
  console.warn("Client-side scheduling is not supported for Real Zoho API.", { to, subject, scheduledTime });
  throw new AppError(AppErrorCode.UNKNOWN, 'ZOHO', "Scheduling is not supported in client-side demo mode for Real APIs.");
};
