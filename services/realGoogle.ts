import { Email, EmailStatus, AppError, AppErrorCode } from '../types';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';
const PROXY_URL = `${API_URL}/api/google/gmail`;
const TOKEN_PROXY_URL = `${API_URL}/api/google/oauth/token`;

// Module-level variable for in-flight refresh requests (Single-flight)
let refreshInFlight: Promise<string> | null = null;

// Helper to encode string to Base64Url (RFC 4648) with UTF-8 support
const base64Url = (s: string) => btoa(unescape(encodeURIComponent(s)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

// Helper to encode string to standard Base64 with UTF-8 support
const base64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

const mimeMessage = (to: string, subject: string, body: string) => {
  // Encode subject to handle UTF-8 characters in headers
  const encodedSubject = `=?UTF-8?B?${base64(subject)}?=`;
  
  // Encode body to Base64 to ensure safe transport of all characters (emojis, etc.)
  const encodedBody = base64(body);

  return [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody
  ].join('\r\n');
};

// Replaces direct fetch with a call to our backend proxy
const proxyFetch = async (accessToken: string | null, endpoint: string, method: string = 'GET', body?: any): Promise<Response> => {
  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken, // Optional: Can be null/undefined for requests that don't need auth or use other auth methods
        endpoint,
        method,
        body
      })
    });
    return response;
  } catch (error: any) {
    console.error("Google Proxy Fetch Error:", error);
    throw new AppError(
      AppErrorCode.NETWORK_ERROR,
      'GOOGLE',
      "Connection to Backend Proxy Failed. Ensure the server is running."
    );
  }
};

const handleApiError = async (response: Response) => {
  if (!response.ok) {
    let errorDetail = "";
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.error?.message || errorJson.error || JSON.stringify(errorJson);
    } catch (e) {
      errorDetail = await response.text();
    }

    if (response.status === 401) {
      throw new AppError(AppErrorCode.AUTH_EXPIRED, 'GOOGLE', "Google Access Token Expired or Invalid. Please refresh your token in Settings.");
    }
    
    if (response.status === 429) {
      throw new AppError(AppErrorCode.RATE_LIMIT, 'GOOGLE', "Google API Rate Limit Exceeded.");
    }
    
    throw new AppError(AppErrorCode.UNKNOWN, 'GOOGLE', `Google API Error (${response.status}): ${errorDetail || response.statusText}`);
  }
  return response.json();
};

export const fetchGoogleEmails = async (accessToken: string): Promise<Email[]> => {
  // 1. List messages from 'me' with 'label:SENT'
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=label:SENT&maxResults=20`;
  const listResponse = await proxyFetch(accessToken, listUrl);
  
  const listData = await handleApiError(listResponse);
  if (!listData.messages || listData.messages.length === 0) return [];

  // 2. Batch get details
  const emails: Email[] = [];
  const messagesToFetch = listData.messages.slice(0, 20);

  // Use Promise.allSettled to allow partial success
  const results = await Promise.allSettled(messagesToFetch.map(async (msg: any) => {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`;
      const detailResponse = await proxyFetch(accessToken, detailUrl);
      const detail = await handleApiError(detailResponse);
      
      const headers = detail.payload.headers;
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
      const to = headers.find((h: any) => h.name === 'To')?.value || '';
      const dateStr = headers.find((h: any) => h.name === 'Date')?.value;
      const snippet = detail.snippet;

      // Robust recipient parsing
      let recipientName = 'Unknown';
      let recipientEmail = to;
      
      if (to) {
        const emailMatch = to.match(/<([^>]+)>/);
        if (emailMatch) {
          recipientEmail = emailMatch[1];
          recipientName = to.split('<')[0].trim().replace(/^"|"$/g, '');
        } else {
          recipientEmail = to.trim();
        }
        
        if (!recipientName || recipientName === recipientEmail) {
           recipientName = recipientEmail.split('@')[0];
        }
      }

      // Safe date parsing
      const sentDate = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

      return {
        id: detail.id,
        recipient: recipientEmail,
        recipientName: recipientName,
        company: 'External',
        subject: subject,
        body: snippet || "(No content)",
        sentDate: sentDate,
        status: EmailStatus.NO_REPLY,
        provider: 'GMAIL'
      } as Email;
  }));

  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value) {
      emails.push(result.value);
    } else if (result.status === 'rejected') {
      console.warn("Failed to fetch specific Google email", result.reason);
    }
  });

  return emails;
};

export const sendGoogleEmail = async (accessToken: string, to: string, subject: string, body: string): Promise<void> => {
  // Construct raw email (RFC 2822) with proper UTF-8 Support
  // We use base64Url encoding for the 'raw' field as required by Gmail API
  const raw = base64Url(mimeMessage(to, subject, body));

  const sendUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`;
  
  const response = await proxyFetch(accessToken, sendUrl, 'POST', {
    raw
  });

  await handleApiError(response);
};

export const exchangeGoogleCode = async (code: string, clientId: string, clientSecret: string, redirectUri: string) => {
  // Call our backend proxy which handles form-encoding for Google
  const response = await fetch(TOKEN_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const data = await response.json();

  if (!response.ok) {
     throw new AppError(AppErrorCode.AUTH_EXPIRED, 'GOOGLE', data.error_description || data.error || 'Failed to exchange Google code');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token, // This should be present if access_type=offline was used
    expires_in: data.expires_in
  };
};

export const refreshGoogleToken = async (clientId: string, clientSecret: string, refreshToken: string): Promise<string> => {
  // Return in-flight promise if one exists
  if (refreshInFlight) {
    return refreshInFlight;
  }

  // Create new refresh promise
  refreshInFlight = (async () => {
    try {
      const response = await fetch(TOKEN_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'invalid_grant') {
           throw new AppError(AppErrorCode.AUTH_EXPIRED, 'GOOGLE', 'Google Refresh Token is invalid or expired. Please reconnect.');
        }
        throw new AppError(AppErrorCode.UNKNOWN, 'GOOGLE', data.error_description || data.error || 'Failed to refresh Google token');
      }

      return data.access_token;
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(AppErrorCode.UNKNOWN, 'GOOGLE', (error as Error).message || 'Network error during token refresh');
    } finally {
      // Clear flight lock
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
};

export const scheduleGoogleEmail = async (
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  scheduledTime: string
): Promise<void> => {
  console.warn("Client-side scheduling is not supported for Real Google API. A backend server is required to hold the job.", { to, subject, scheduledTime });
  throw new AppError(AppErrorCode.UNKNOWN, 'GOOGLE', "Scheduling requires a backend job queue and is not available in this demo.");
};
