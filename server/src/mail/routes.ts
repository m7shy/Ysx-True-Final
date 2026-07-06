import express, { Request, Response } from "express";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import { requireUserId } from "../auth/middleware.js";
import { MailError } from "../httpErrors.js";
import {
  getMailboxConnection,
  listMailboxes as listUserMailboxes,
} from "../creds/mailboxStore.js";

/**
 * Mail router (tenant-scoped).
 * - Credentials are resolved from the database per authenticated user
 *   (see creds/mailboxStore.ts) — NOT from process.env single-user config.
 * - IMAP/SMTP authenticate via XOAUTH2 using the mailbox's stored OAuth token.
 *
 * This router is mounted behind requireAuth, so req.auth.userId is always set.
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

// Resolved IMAP connection for a tenant's mailbox (XOAUTH2).
type ImapConn = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  accessToken: string;
};

const providerSchema = z.enum(["gmail", "zoho", "microsoft"]);

function parseProvider(raw: unknown): Provider {
  // Default to gmail when missing. Also accept common aliases.
  const rawVal = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!rawVal) return "gmail";

  const normalized = (() => {
    switch (rawVal) {
      case "outlook":
      case "office365":
      case "o365":
      case "microsoft365":
      case "ms365":
        return "microsoft";

      case "google":
      case "workspace":
      case "googleworkspace":
      case "google_workspace":
        return "gmail";

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

/** Resolve a tenant's mailbox IMAP connection (with a fresh access token). */
async function resolveImapConn(userId: string, provider: Provider): Promise<ImapConn> {
  const conn = await getMailboxConnection(userId, provider);
  return {
    host: conn.imapHost,
    port: conn.imapPort,
    secure: conn.imapSecure,
    user: conn.email,
    accessToken: conn.accessToken,
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

const MAIL_ERROR_STATUS: Record<MailError["code"], number> = {
  AUTH: 401,
  DENIED: 403,
  TIMEOUT: 504,
  TRANSIENT: 503,
  UNKNOWN: 500,
};

function sendError(res: Response, err: unknown) {
  let status = 500;
  let code = "UNEXPECTED";
  let message = "Unexpected error";

  // Credential-resolution errors carry a semantic code but no HTTP status.
  if (err instanceof MailError) {
    res.status(MAIL_ERROR_STATUS[err.code]).json({ code: err.code, message: err.message });
    return;
  }

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
 * Health check — reports the authenticated tenant's connected mailboxes,
 * resolved from the database (no global env configuration).
 * GET /api/mail/health
 */
router.get("/health", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const mailboxes = await listUserMailboxes(userId);
    res.json({
      ok: true,
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        email: m.email,
        provider: m.provider,
        isActive: m.isActive,
        expiresAt: m.expiresAt,
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Fetch recent messages from the Sent folder.
 * GET /api/mail/sent?provider=gmail&limit=20
 */
router.get("/sent", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const provider = parseProvider(req.query.provider);
    const limit = parseLimit(req.query.limit);

    const cfg = await resolveImapConn(userId, provider);
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
    const userId = requireUserId(req);
    const provider = parseProvider(req.query.provider);
    const uid = Number(req.params.uid);
    if (!Number.isFinite(uid) || uid <= 0) {
      throw makeHttpError(400, "INVALID_UID", "uid must be a positive number");
    }

    const cfg = await resolveImapConn(userId, provider);
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
 * Send a message using SMTP (XOAUTH2 with the tenant's stored mailbox token).
 */
router.post("/send", express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const raw: any = req.body ?? {};
    const provider = parseProvider(
      (req.query.provider as string | undefined) ?? (raw.provider as string | undefined) ?? "gmail"
    );

    const conn = await getMailboxConnection(userId, provider);

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

    // From MUST be the authenticated mailbox. A client-supplied "from" becomes Reply-To.
    const fromAddress = conn.email;
    const fromName = process.env.MAIL_FROM_NAME;
    const fromHeader = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
    const replyToValue = typeof raw.from === "string" && raw.from.includes("@") ? raw.from : undefined;

    const transporter = nodemailer.createTransport({
      host: conn.smtpHost,
      port: conn.smtpPort,
      secure: conn.smtpSecure,
      // When using port 587 (STARTTLS), enforce TLS upgrade.
      requireTLS: !conn.smtpSecure,
      auth: {
        type: "OAuth2",
        user: conn.email,
        accessToken: conn.accessToken,
      },
      tls: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    } as any);

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

  const sentByFlag = list.find((box: any) => {
    const su = typeof box.specialUse === "string" ? box.specialUse.toLowerCase() : "";
    return su === "\\sent";
  });
  if (sentByFlag) return sentByFlag.path;

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

  const fuzzy = list.find((box: any) => normalize(String(box.path || "")).includes("sent"));
  if (fuzzy) return fuzzy.path;

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

function toSentItem(msg: any, cfg: ImapConn): SentItem {
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

async function fetchLastFromCurrentMailbox(client: ImapFlow, cfg: ImapConn, limit: number): Promise<SentItem[]> {
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

async function fetchGmailSentFallback(client: ImapFlow, cfg: ImapConn, limit: number): Promise<SentItem[]> {
  const allMailPath = await findGmailAllMailBoxPath(client);

  const mailboxToOpen = allMailPath || "INBOX";
  await client.mailboxOpen(mailboxToOpen, { readOnly: true });

  const searchResult = await client.search({ gmraw: "in:sent" }, { uid: true });
  if (!searchResult || !Array.isArray(searchResult) || searchResult.length === 0) {
    return [];
  }

  const uids = searchResult.slice(-limit);
  const items: SentItem[] = [];

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
    const base =
      "IMAP authentication failed. Reconnect the Microsoft mailbox (the stored OAuth token may be expired or revoked).";
    return detail ? `${base} Server said: ${detail}` : base;
  }
  return detail ? `IMAP authentication failed. Server said: ${detail}` : "IMAP authentication failed";
}

/** Connect to IMAP using XOAUTH2 with the mailbox's stored access token. */
async function connectImap(provider: Provider, cfg: ImapConn): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    servername: cfg.host,
    auth: {
      user: cfg.user,
      accessToken: cfg.accessToken,
    },
    connectionTimeout: provider === "microsoft" ? 60_000 : 15_000,
    greetingTimeout: provider === "microsoft" ? 60_000 : 15_000,
    socketTimeout: provider === "microsoft" ? 120_000 : 30_000,
    logger: false,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  });

  await client.connect();
  return client;
}

/**
 * Helper: fetch last `limit` messages from the Sent mailbox using ImapFlow.
 * Gmail falls back to All Mail + X-GM-RAW in:sent when Sent isn't discoverable.
 */
async function fetchSentViaImap(provider: Provider, cfg: ImapConn, limit: number): Promise<SentItem[]> {
  let client: ImapFlow | null = null;

  try {
    client = await connectImap(provider, cfg);

    try {
      const sentPath = await findSentBoxPath(client, provider);
      await client.mailboxOpen(sentPath, { readOnly: true });
      return await fetchLastFromCurrentMailbox(client, cfg, limit);
    } catch (err: unknown) {
      if (provider === "gmail" && isMailboxNotFoundError(err)) {
        return await fetchGmailSentFallback(client, cfg, limit);
      }
      throw err;
    }
  } catch (err: unknown) {
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
