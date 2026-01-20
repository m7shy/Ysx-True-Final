import express, { Request, Response } from "express";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { getMicrosoftImapAccessToken } from "./microsoftOauth.js";

/**
 * Mail router (self-contained)
 * - IMAP: fetch Sent emails (Gmail, Zoho, or Microsoft)
 * - SMTP: send emails using server-side app passwords
 *
 * Path: server/src/mail/routes.ts
 */

const router = express.Router();

type Provider = "gmail" | "zoho" | "microsoft";

type SentItem = {
  uid: number;
  id?: string;
  subject: string;
  from: string;
  to: string[];
  date: string; // ISO
  snippet: string;
  attachments: {
    id: string;
    filename: string;
    size: number;
    contentType: string;
  }[];
};

const providerSchema = z.enum(["gmail", "zoho", "microsoft"]);

function parseProvider(raw: unknown): Provider {
  // Default to gmail when missing. Also accept common aliases.
  const rawVal = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!rawVal) return "gmail";

  const normalized = (() => {
    switch (rawVal) {
      // Microsoft aliases
      case "outlook":
      case "office365":
      case "o365":
      case "microsoft365":
      case "ms365":
        return "microsoft";

      // Google aliases
      case "google":
      case "workspace":
      case "googleworkspace":
      case "google_workspace":
        return "gmail";

      // Zoho aliases
      case "zoho_mail":
        return "zoho";

      default:
        return rawVal;
    }
  })();

  const parsed = providerSchema.safeParse(normalized);
  if (!parsed.success) {
    throw makeHttpError(400, "INVALID_PROVIDER", "provider must be 'gmail', 'zoho', or 'microsoft'");
  }
  return parsed.data;
}

function parseLimit(raw: unknown): number {
  if (typeof raw !== "string") return 20;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  if (n > 100) return 100;
  return Math.floor(n);
}

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

type ImapLoginMethod = "LOGIN" | "AUTH=LOGIN" | "AUTH=PLAIN";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function isMicrosoftConsumerUser(user: string): boolean {
  const domain = String(user.split("@")[1] || "")
    .trim()
    .toLowerCase();
  return ["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain);
}

function getImapConfig(provider: Provider): ImapConfig {
  if (provider === "gmail") {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw makeHttpError(401, "AUTH", "Missing GMAIL_USER or GMAIL_APP_PASSWORD in server .env");
    }
    return {
      host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
      port: process.env.GMAIL_IMAP_PORT ? Number(process.env.GMAIL_IMAP_PORT) : 993,
      secure: true,
      user,
      pass,
    };
  }

  if (provider === "microsoft") {
    const user = process.env.MICROSOFT_USER;
    const pass = process.env.MICROSOFT_APP_PASSWORD;
    if (!user || !pass) {
      throw makeHttpError(401, "AUTH", "Missing MICROSOFT_USER or MICROSOFT_APP_PASSWORD in server .env");
    }

    // Default to Exchange Online IMAP endpoint; can be overridden via MICROSOFT_IMAP_HOST.
    const defaultHost = "outlook.office365.com";
    const host = process.env.MICROSOFT_IMAP_HOST || defaultHost;
    const port = process.env.MICROSOFT_IMAP_PORT ? Number(process.env.MICROSOFT_IMAP_PORT) : 993;

    return {
      host,
      port,
      secure: true,
      user,
      pass,
    };
  }

  // Zoho
  const user = process.env.ZOHO_USER;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) {
    throw makeHttpError(401, "AUTH", "Missing ZOHO_USER or ZOHO_APP_PASSWORD in server .env");
    }

  // Default to pro host; can be overridden via ZOHO_IMAP_HOST
  const host = process.env.ZOHO_IMAP_HOST || "imappro.zoho.com";

  return {
    host,
    port: 993,
    secure: true,
    user,
    pass,
  };
}

function getSmtpConfig(provider: Provider): SmtpConfig {
  if (provider === "gmail") {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw makeHttpError(401, "AUTH", "Missing GMAIL_USER or GMAIL_APP_PASSWORD in server .env");
    }
    return {
      host: process.env.GMAIL_SMTP_HOST || "smtp.gmail.com",
      port: process.env.GMAIL_SMTP_PORT ? Number(process.env.GMAIL_SMTP_PORT) : 465,
      secure: true,
      user,
      pass,
    };
  }

  if (provider === "microsoft") {
    const user = process.env.MICROSOFT_USER;
    const pass = process.env.MICROSOFT_APP_PASSWORD;
    if (!user || !pass) {
      throw makeHttpError(401, "AUTH", "Missing MICROSOFT_USER or MICROSOFT_APP_PASSWORD in server .env");
    }

    const defaultHost = isMicrosoftConsumerUser(user) ? "smtp-mail.outlook.com" : "smtp.office365.com";
    const host = process.env.MICROSOFT_SMTP_HOST || defaultHost;
    const port = process.env.MICROSOFT_SMTP_PORT ? Number(process.env.MICROSOFT_SMTP_PORT) : 587;

    return {
      host,
      port,
      secure: port === 465,
      user,
      pass,
    };
  }

  // Zoho
  const user = process.env.ZOHO_USER;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) {
    throw makeHttpError(401, "AUTH", "Missing ZOHO_USER or ZOHO_APP_PASSWORD in server .env");
  }

  // Default to smtppro.zoho.com (Mail Lite / Pro)
  const host = process.env.ZOHO_SMTP_HOST || "smtppro.zoho.com";
  const port = process.env.ZOHO_SMTP_PORT ? Number(process.env.ZOHO_SMTP_PORT) : 587;
  const secure = port === 465; // 465 = SSL, 587 = STARTTLS

  return {
    host,
    port,
    secure,
    user,
    pass,
  };
}

type HttpError = Error & {
  status?: number;
  code?: string;
};

function makeHttpError(status: number, code: string, message: string): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  err.code = code;
  return err;
}

function sendError(res: Response, err: unknown) {
  let status = 500;
  let code = "UNEXPECTED";
  let message = "Unexpected error";

  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number") status = e.status;
    if (typeof e.code === "string") code = e.code;
    if (typeof e.message === "string") message = e.message;

    // Nodemailer relay errors
    if (e.code === "EMESSAGE" && typeof (e as any).responseCode === "number") {
      if ((e as any).responseCode === 553) {
        status = 403;
        code = "DENIED";
        message =
          "Sender is not allowed to relay emails. The SMTP user address must match the From: address.";
      }
    }

    // ImapFlow sometimes includes a raw server response
    if (status === 500 && typeof (e as any).response === "string" && ((e as any).response as string).trim()) {
      message = `${message} (${((e as any).response as string).trim()})`;
    }
  }

  res.status(status).json({ code, message });
}

/**
 * Health check
 * GET /api/mail/health
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    gmailConfigured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    zohoConfigured: !!(process.env.ZOHO_USER && process.env.ZOHO_APP_PASSWORD),
    microsoftConfigured: !!(process.env.MICROSOFT_USER && process.env.MICROSOFT_APP_PASSWORD),
  });
});

/**
 * Fetch recent messages from the Sent folder.
 * GET /api/mail/sent?provider=gmail&limit=20
 */
router.get("/sent", async (req: Request, res: Response) => {
  try {
    const provider = parseProvider(req.query.provider);
    const limit = parseLimit(req.query.limit);

    const cfg = getImapConfig(provider);
    const items = await fetchSentViaImap(provider, cfg, limit);

    res.json({ items });
  } catch (err) {
    console.error("[/sent] error", err);
    sendError(res, err);
  }
});

/**
 * Fetch a single message by UID.
 * GET /api/mail/sent/:uid?provider=gmail
 */
router.get("/sent/:uid", async (req: Request, res: Response) => {
  try {
    const provider = parseProvider(req.query.provider);
    const uid = Number(req.params.uid);
    if (!Number.isFinite(uid) || uid <= 0) {
      throw makeHttpError(400, "INVALID_UID", "uid must be a positive number");
    }

    const cfg = getImapConfig(provider);
    const items = await fetchSentViaImap(provider, cfg, 200);
    const found = items.find((m) => m.uid === uid);
    if (!found) {
      throw makeHttpError(404, "NOT_FOUND", "Message not found in Sent mailbox");
    }

    res.json(found);
  } catch (err) {
    console.error("[/sent/:uid] error", err);
    sendError(res, err);
  }
});

/**
 * Send a message using SMTP.
 */
router.post("/send", express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
  try {
    const raw: any = req.body ?? {};
    const provider = parseProvider(
      (req.query.provider as string | undefined) ?? (raw.provider as string | undefined) ?? "gmail"
    );
    const smtp = getSmtpConfig(provider);

    const toRaw = raw.to;
    const subject: string | undefined = raw.subject;

    const bodyText: string | undefined =
      (typeof raw.body === "string" && raw.body.trim()) ||
      (typeof raw.text === "string" && raw.text.trim()) ||
      (typeof raw.html === "string" && raw.html.trim()) ||
      undefined;

    let toList: string[] = [];
    if (Array.isArray(toRaw)) {
      toList = toRaw
        .filter((v: unknown): v is string => typeof v === "string")
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (typeof toRaw === "string") {
      toList = toRaw
        .split(/[;,]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    if (!toList.length || !subject || !bodyText) {
      throw makeHttpError(400, "INVALID_INPUT", "to, subject and body are required");
    }

    const fromAddress = smtp.user;
    const fromName = process.env.MAIL_FROM_NAME;
    const fromHeader = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    // Client may optionally send "from" which we treat as Reply-To (never as SMTP From).
    const replyToValue = typeof raw.from === "string" && raw.from.includes("@") ? raw.from : undefined;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // When using port 587 (STARTTLS), enforce TLS upgrade.
      requireTLS: !smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
      tls: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    });

    const mailOptions: any = {
      from: fromHeader,
      to: toList.join(", "),
      subject,
      text: bodyText,
    };

    if (replyToValue) {
      mailOptions.replyTo = replyToValue;
    }

    const info = await transporter.sendMail(mailOptions);

    res.json({
      ok: true,
      messageId: info.messageId,
    });
  } catch (err) {
    console.error("[/send] error", err);
    sendError(res, err);
  }
});

function getSpecialUseHints(provider: Provider): Record<string, string> {
  // ImapFlow ListOptions.specialUseHints supports these keys: all, archive, drafts, flagged, junk, sent, trash
  if (provider === "gmail") {
    return {
      sent: "[Gmail]/Sent Mail",
      drafts: "[Gmail]/Drafts",
      trash: "[Gmail]/Trash",
      junk: "[Gmail]/Spam",
      all: "[Gmail]/All Mail",
      archive: "[Gmail]/All Mail",
    };
  }

  if (provider === "microsoft") {
    return {
      sent: "Sent Items",
      drafts: "Drafts",
      trash: "Deleted Items",
      junk: "Junk Email",
    };
  }

  // Zoho
  return {
    sent: "Sent",
    drafts: "Drafts",
    trash: "Trash",
    junk: "Spam",
  };
}

async function listMailboxes(client: ImapFlow, provider: Provider): Promise<any[]> {
  return await client.list({ specialUseHints: getSpecialUseHints(provider) });
}

/**
 * Helper: Find the "Sent" folder intelligently.
 * 1. Checks for IMAP Special-Use flag "\Sent"
 * 2. Checks for common names
 * 3. Fallback to fuzzy match
 */
async function findSentBoxPath(client: ImapFlow, provider: Provider): Promise<string> {
  const list = await listMailboxes(client, provider);

  // 1. Check Special Use Flags
  const sentByFlag = list.find((box: any) => {
    const su = typeof box.specialUse === "string" ? box.specialUse.toLowerCase() : "";
    return su === "\\sent";
  });
  if (sentByFlag) return sentByFlag.path;

  // 2. Check Common Names (Case Insensitive)
  const baseCandidates = ["Sent", "Sent Messages", "Sent Mail", "Sent Items"];
  const providerCandidates =
    provider === "gmail"
      ? ["[Gmail]/Sent Mail", "[Google Mail]/Sent Mail"]
      : provider === "microsoft"
        ? ["Sent Items"]
        : ["Sent"];

  const candidates = [...providerCandidates, ...baseCandidates];

  const normalize = (s: string) => s.trim().toLowerCase();
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const found = list.find((box: any) => normalize(String(box.path || "")) === target);
    if (found) return found.path;
  }

  // 3. Last Resort: first folder containing "sent"
  const fuzzy = list.find((box: any) => normalize(String(box.path || "")).includes("sent"));
  if (fuzzy) return fuzzy.path;

  // 4. Debugging Output if completely lost
  console.error("---------------------------------------------------");
  console.error(`ERROR: Could not auto-discover a 'Sent' folder for provider: ${provider}`);
  console.error("Available folders:");
  list.forEach((box: any) =>
    console.error(` - ${box.path} (specialUse: ${box.specialUse}, subscribed: ${box.subscribed})`)
  );
  console.error("---------------------------------------------------");

  throw makeHttpError(404, "MAILBOX_NOT_FOUND", "Could not auto-discover Sent mailbox.");
}

async function findGmailAllMailBoxPath(client: ImapFlow): Promise<string | null> {
  const list = await listMailboxes(client, "gmail");
  const normalize = (s: string) => s.trim().toLowerCase();

  const allByFlag = list.find((box: any) => {
    const su = typeof box.specialUse === "string" ? box.specialUse.toLowerCase() : "";
    return su === "\\all" || su === "\\archive";
  });
  if (allByFlag) return allByFlag.path;

  const candidates = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "All Mail", "[Gmail]/Archive", "Archive"];

  for (const candidate of candidates) {
    const target = normalize(candidate);
    const found = list.find((box: any) => normalize(String(box.path || "")) === target);
    if (found) return found.path;
  }

  const fuzzy = list.find((box: any) => {
    const p = normalize(String(box.path || ""));
    return p.includes("all mail") || p.includes("archive");
  });
  return fuzzy ? fuzzy.path : null;
}

function isMailboxNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  return e.code === "MAILBOX_NOT_FOUND";
}

function toSentItem(msg: any, cfg: ImapConfig): SentItem {
  const envelope: any = msg?.envelope;

  const subject = envelope?.subject || "(no subject)";
  const fromAddress = envelope?.from?.[0]?.address || envelope?.from?.[0]?.name || cfg.user;

  const tos: string[] =
    (envelope?.to || [])
      .map((addr: any) => addr.address || addr.name)
      .filter((v: any): v is string => !!v) || [];

  const date = (
    envelope?.date instanceof Date ? envelope.date : new Date(envelope?.date || Date.now())
  ).toISOString();

  return {
    uid: msg?.uid || 0,
    id: envelope?.messageId || undefined,
    subject,
    from: fromAddress,
    to: tos,
    date,
    snippet: "",
    attachments: [],
  };
}

async function fetchLastFromCurrentMailbox(client: ImapFlow, cfg: ImapConfig, limit: number): Promise<SentItem[]> {
  let exists = 0;
  const mailbox: any = (client as any).mailbox;
  if (mailbox && typeof mailbox === "object" && typeof mailbox.exists === "number") {
    exists = mailbox.exists;
  }

  if (!exists) return [];

  const startSeq = Math.max(1, exists - limit + 1);
  const range = `${startSeq}:*`;

  const items: SentItem[] = [];

  for await (const msg of client.fetch(range, { uid: true, envelope: true })) {
    items.push(toSentItem(msg, cfg));
  }

  items.sort((a: SentItem, b: SentItem) => b.uid - a.uid);
  return items.slice(0, limit);
}

async function fetchGmailSentFallback(client: ImapFlow, cfg: ImapConfig, limit: number): Promise<SentItem[]> {
  const allMailPath = await findGmailAllMailBoxPath(client);

  // Prefer All Mail because it reliably contains sent messages even when "Sent Mail" isn't shown in IMAP.
  const mailboxToOpen = allMailPath || "INBOX";
  await client.mailboxOpen(mailboxToOpen, { readOnly: true });

  const searchResult = await client.search({ gmraw: "in:sent" }, { uid: true });
  if (!searchResult || !Array.isArray(searchResult) || searchResult.length === 0) {
    return [];
  }

  const uids = searchResult.slice(-limit);
  const items: SentItem[] = [];

  // Fetch by UID list (third arg { uid: true } means numbers are UIDs)
  for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
    items.push(toSentItem(msg, cfg));
  }

  items.sort((a: SentItem, b: SentItem) => b.uid - a.uid);
  return items.slice(0, limit);
}

function isImapAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  if (e.code === "EAUTH" || e.authenticationFailed === true) return true;
  const msg = typeof e.message === "string" ? e.message : "";
  const resp = typeof e.response === "string" ? e.response : "";
  return (
    /authenticate failed/i.test(msg) ||
    /authenticate failed/i.test(resp) ||
    /invalid credentials/i.test(msg) ||
    /login failed/i.test(msg) ||
    /authentication unsuccessful/i.test(msg) ||
    /AUTHENTICATIONFAILED/i.test(resp)
  );
}

function safeShortImapDetail(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as any;
  const parts: string[] = [];
  if (typeof e.response === "string" && e.response.trim()) parts.push(e.response.trim());
  if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
  const joined = parts.filter(Boolean).join(" | ");
  return joined.length > 240 ? `${joined.slice(0, 240)}…` : joined;
}

function authErrorMessage(provider: Provider, err?: unknown): string {
  const detail = safeShortImapDetail(err);
  if (provider === "microsoft") {
    // Check for specific refresh failure messages
    if (detail.includes("Token refresh failed") || detail.includes("AADSTS700025")) {
      return `Microsoft OAuth refresh failed. ${detail} (Public client apps must not send client_secret. Either remove MICROSOFT_CLIENT_SECRET or use a confidential client app registration)`;
    }

    const base =
      "IMAP authentication failed. Verify IMAP is enabled for the mailbox and that Basic Auth/App Passwords are allowed by your tenant policies (many tenants require OAuth2 for IMAP).";
    return detail ? `${base} Server said: ${detail}` : base;
  }
  return detail ? `Invalid IMAP credentials. Server said: ${detail}` : "Invalid IMAP credentials";
}

function parseImapLoginMethod(raw: unknown): ImapLoginMethod | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toUpperCase();
  if (v === "LOGIN" || v === "AUTH=LOGIN" || v === "AUTH=PLAIN") {
    return v as ImapLoginMethod;
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function getMicrosoftPasswordCandidates(pass: string): string[] {
  const candidates = [pass];
  // App passwords are often copied with spaces (eg "abcd efgh ijkl mnop").
  // Try both raw and de-spaced to reduce friction.
  const collapsed = pass.replace(/\s+/g, "");
  if (collapsed && collapsed !== pass) candidates.push(collapsed);
  return uniqueStrings(candidates);
}

function getMicrosoftLoginMethodCandidates(): ImapLoginMethod[] {
  // NOTE:
  // According to ImapFlow docs, loginMethod is a property under auth:
  // auth.loginMethod = 'LOGIN' | 'AUTH=LOGIN' | 'AUTH=PLAIN'
  const env = parseImapLoginMethod(process.env.MICROSOFT_IMAP_LOGIN_METHOD);
  const defaults: ImapLoginMethod[] = ["LOGIN", "AUTH=LOGIN", "AUTH=PLAIN"];
  const combined = [env, ...defaults].filter(Boolean) as ImapLoginMethod[];
  return uniqueStrings(combined) as ImapLoginMethod[];
}

async function connectImap(provider: Provider, cfg: ImapConfig): Promise<ImapFlow> {
  // Keep non-Microsoft behavior identical to avoid regressing working providers.
  if (provider !== "microsoft") {
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: {
        user: cfg.user,
        pass: cfg.pass,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    });

    await client.connect();
    return client;
  }

  // Microsoft: Try OAuth2 first
  let oauthToken: string | undefined;
  let oauthError: unknown;
  try {
    oauthToken = await getMicrosoftImapAccessToken(cfg.user);
  } catch (err) {
    oauthError = err;
  }

  if (oauthToken) {
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      servername: cfg.host,
      auth: {
        user: cfg.user,
        accessToken: oauthToken,
      },
      connectionTimeout: 60_000,
      greetingTimeout: 60_000,
      socketTimeout: 120_000,
      logger: false,
      tls: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    });

    try {
      await client.connect();
      return client;
    } catch (err) {
      console.error("Microsoft OAuth2 connection failed:", err);
      // If OAuth connection failed, we might want to throw here or fall back?
      // Usually if we have a token and it fails, it's a real auth error.
      // But let's allow fallback to basic just in case the token was for a different scope/tenant logic mismatch.
      oauthError = err;
    }
  }

  // Fallback to Basic Auth (Legacy / App Passwords)
  const loginMethods = getMicrosoftLoginMethodCandidates();
  const passCandidates = getMicrosoftPasswordCandidates(cfg.pass);

  let lastErr: unknown;

  for (const pass of passCandidates) {
    for (const loginMethod of loginMethods) {
      const auth: any = { user: cfg.user, pass };
      auth.loginMethod = loginMethod;

      const client = new ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        servername: cfg.host,
        auth,
        connectionTimeout: 60_000,
        greetingTimeout: 60_000,
        socketTimeout: 120_000,
        logger: false,
        tls: {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
      });

      try {
        await client.connect();
        return client;
      } catch (err) {
        lastErr = err;
        try {
          await client.logout();
        } catch {
          // ignore
        }
      }
    }
  }

  // If we had an OAuth error initially, and basic auth also failed,
  // append the OAuth error to the message so the user knows what's missing.
  if (oauthError) {
    // If the OAuth error was a specific AUTH failure (like the public client issue), prioritize it.
    if ((oauthError as any).code === 'AUTH' && (oauthError as any).status === 401) {
      throw oauthError;
    }
    const msg = (oauthError as any)?.message || String(oauthError);
    throw new Error(`Authentication failed. OAuth2 error: ${msg}. Basic Auth error: ${(lastErr as any)?.message}`);
  }

  throw lastErr;
}

/**
 * Helper: fetch last `limit` messages from the Sent mailbox using ImapFlow.
 *
 * Fixes:
 * - Microsoft: auth.loginMethod override (tries LOGIN / AUTH=LOGIN / AUTH=PLAIN)
 * - Gmail: fallback to All Mail + X-GM-RAW in:sent when Sent mailbox is missing/unshown
 */
async function fetchSentViaImap(provider: Provider, cfg: ImapConfig, limit: number): Promise<SentItem[]> {
  let client: ImapFlow | null = null;

  try {
    client = await connectImap(provider, cfg);

    try {
      const sentPath = await findSentBoxPath(client, provider);
      await client.mailboxOpen(sentPath, { readOnly: true });
      return await fetchLastFromCurrentMailbox(client, cfg, limit);
    } catch (err: unknown) {
      // Gmail: if Sent mailbox isn't discoverable, search for sent mail via All Mail.
      if (provider === "gmail" && isMailboxNotFoundError(err)) {
        return await fetchGmailSentFallback(client, cfg, limit);
      }
      throw err;
    }
  } catch (err: unknown) {
    // Check if it's already a 401/AUTH error from OAuth (has status/code props)
    if (err && typeof err === 'object' && (err as any).status === 401 && (err as any).code === 'AUTH') {
      throw err;
    }

    if (isImapAuthError(err)) {
      throw makeHttpError(401, "AUTH", authErrorMessage(provider, err));
    }
    throw err;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }
}

export default router;
