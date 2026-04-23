
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import client from 'prom-client';
import { sendMail } from './mail/smtpClient.js';
import { fetchSent } from './mail/imapClient.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Trust Proxy for Rate Limiting behind load balancers/proxies
app.set('trust proxy', 1);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "upgrade-insecure-requests": null,
    }
  }
}));

// Increase payload limit for email bodies
app.use(express.json({ limit: '50mb' }));

// CORS
app.use(cors({
  origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

// Initialize Gemini Client server-side
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Helpers ---
const DEFAULT_ALLOW = [
  'imap.gmail.com',
  'smtp.gmail.com',
  'imap.zoho.com',
  'imap.zoho.eu',
  'imap.zoho.in',
  'smtp.zoho.com',
  'smtp.zoho.eu',
  'smtp.zoho.in'
];
const ALLOW = new Set(
  (process.env.ALLOWLIST_HOSTS || DEFAULT_ALLOW.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

const ALLOWED_PROXY_HOSTS = new Set([
  'gmail.googleapis.com',
  'oauth2.googleapis.com',
  'accounts.zoho.com',
  'accounts.zoho.eu',
  'accounts.zoho.in',
  'mail.zoho.com'
]);

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const sendDuration = new client.Histogram({
  name: 'send_duration_ms',
  help: 'Duration of SMTP send operations in ms',
  buckets: [100, 500, 1000, 2000, 5000, 10000],
  registers: [registry]
});

const sendTotal = new client.Counter({
  name: 'send_total',
  help: 'Total number of emails sent successfully',
  registers: [registry]
});

const fetchTotal = new client.Counter({
  name: 'fetch_total',
  help: 'Total number of successful IMAP fetches',
  registers: [registry]
});

const errorsTotal = new client.Counter({
  name: 'errors_total',
  help: 'Total number of errors by code',
  labelNames: ['code'],
  registers: [registry]
});

function assertProxyAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    const e = new Error('Invalid endpoint URL');
    e.code = 'DENIED';
    throw e;
  }

  if (u.protocol !== 'https:' || !ALLOWED_PROXY_HOSTS.has(u.hostname)) {
    const e = new Error('Endpoint not allowed');
    e.code = 'DENIED';
    throw e;
  }
}

function assertAllowed(host) {
  if (!ALLOW.has(host)) {
    const e = new Error("Host not allowed");
    e.code = "DENIED";
    throw e;
  }
}

const handleMailError = (res, err) => {
  const code = err.code || 'UNKNOWN';
  const message = err.message || 'Internal Error';
  console.error("Mail Error:", message, code);

  errorsTotal.inc({ code });

  const statusMap = {
    'AUTH': 401,
    'DENIED': 400,
    'TIMEOUT': 504,
    'TRANSIENT': 503,
    'UNKNOWN': 500
  };
  
  res.status(statusMap[code] || 500).json({ error: message, code });
};

// --- Mail Gateway Routes ---

app.get('/api/mail/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.get('/api/mail/sent', async (req, res) => {
  try {
    const { provider, limit } = req.query;
    let host, user, pass;
    
    if (provider === 'gmail') {
      host = 'imap.gmail.com';
      user = process.env.GMAIL_USER;
      pass = process.env.GMAIL_APP_PASSWORD;
    } else if (provider === 'zoho') {
      host = 'imap.zoho.com';
      user = process.env.ZOHO_USER;
      pass = process.env.ZOHO_APP_PASSWORD;
    } else {
      throw { code: 'DENIED', message: 'Invalid provider' };
    }
    
    assertAllowed(host);
    if (!user || !pass) throw { code: 'AUTH', message: 'Credentials not configured' };

    const items = await fetchSent({
      host,
      user,
      pass,
      limit: parseInt(limit) || 20
    });

    fetchTotal.inc();

    res.json({ items });
  } catch (e) {
    handleMailError(res, e);
  }
});

app.post('/api/mail/send', async (req, res) => {
  try {
    const { provider, from, to, subject, text, html, attachments } = req.body;
    let host, user, pass;

    const start = Date.now();

    if (provider === 'gmail') {
      host = 'smtp.gmail.com';
      user = process.env.GMAIL_USER;
      pass = process.env.GMAIL_APP_PASSWORD;
    } else if (provider === 'zoho') {
      host = 'smtp.zoho.com';
      user = process.env.ZOHO_USER;
      pass = process.env.ZOHO_APP_PASSWORD;
    } else {
      throw { code: 'DENIED', message: 'Invalid provider' };
    }

    assertAllowed(host);
    if (!user || !pass) throw { code: 'AUTH', message: 'Credentials not configured' };

    const result = await sendMail({
      host,
      user,
      pass,
      from,
      to,
      subject,
      text,
      html,
      attachments
    });

    sendTotal.inc();
    sendDuration.observe(Date.now() - start);

    res.json(result);
  } catch (e) {
    sendDuration.observe(Date.now() - start);
    handleMailError(res, e);
  }
});

// --- Google Gmail Proxy ---
// Handles Generic API Calls to Gmail (Listing, Sending, etc.)
app.post('/api/google/gmail', async (req, res) => {
  const { accessToken, endpoint, method = 'GET', body } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint' });
  }

  try {
    assertProxyAllowed(endpoint);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Endpoint not allowed' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Only attach Authorization if accessToken is provided
  // This allows the proxy to be used for unauthenticated endpoints or setup flows if needed
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const googleResponse = await fetch(endpoint, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    // Handle 204 No Content gracefully
    const text = await googleResponse.text();
    const data = text ? JSON.parse(text) : {};

    if (!googleResponse.ok) {
      // Forward Google API error details to client
      return res.status(googleResponse.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Google Proxy Error:", error);
    res.status(500).json({ error: "Failed to proxy request to Google" });
  }
});

// --- Google OAuth Token Proxy (Code Exchange & Refresh) ---
// Handles Token Exchange specifically (requires Form Data)
app.post('/api/google/oauth/token', async (req, res) => {
  const { client_id, client_secret, refresh_token, code, grant_type, redirect_uri } = req.body;

  if (!client_id || !client_secret || !grant_type) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // Google requires application/x-www-form-urlencoded for token endpoints
    const params = new URLSearchParams();
    params.append('client_id', client_id);
    params.append('client_secret', client_secret);
    params.append('grant_type', grant_type);
    
    if (refresh_token) params.append('refresh_token', refresh_token);
    if (code) params.append('code', code);
    if (redirect_uri) params.append('redirect_uri', redirect_uri);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Google Token Error:", error);
    res.status(500).json({ error: "Failed to exchange/refresh token" });
  }
});

// --- Zoho Mail Proxy ---
app.post('/api/zoho', async (req, res) => {
  // AccessToken is now OPTIONAL (for token refresh requests)
  const { accessToken, endpoint, method = 'GET', body } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint' });
  }

  try {
    assertProxyAllowed(endpoint);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Endpoint not allowed' });
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  // Only attach Auth header if we actually have a token
  if (accessToken) {
    headers['Authorization'] = `Zoho-oauthtoken ${accessToken}`;
  }

  try {
    const zohoResponse = await fetch(endpoint, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    // Zoho sometimes returns 204 No Content
    const text = await zohoResponse.text();
    const data = text ? JSON.parse(text) : {};

    if (!zohoResponse.ok) {
      return res.status(zohoResponse.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Zoho Proxy Error:", error);
    res.status(500).json({ error: "Failed to proxy request to Zoho" });
  }
});

// --- Gemini AI Proxy ---
app.post('/api/gemini/generate', async (req, res) => {
  const { model, contents, config } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server configuration error: Missing GEMINI_API_KEY" });
  }

  try {
    const response = await ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents,
      config
    });

    // Extract text and return simple JSON
    res.json({ text: response.text });
  } catch (error) {
    console.error("Gemini Proxy Error:", error);
    res.status(500).json({ error: error.message || "AI Generation Failed" });
  }
});

app.listen(port, () => {
  console.log(`YSX Flow Backend running on http://localhost:${port}`);
});
