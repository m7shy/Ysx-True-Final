import { config } from '../config.js';
import { MailError } from '../httpErrors.js';
import { sendMail } from './smtpClient.js';
import type { ProviderName } from './types.js';

export { ProviderName };

export function parseProvider(raw: unknown, fallback: ProviderName = 'zoho'): ProviderName {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'gmail' || v === 'google') return 'gmail';
  if (v === 'zoho') return 'zoho';
  if (v === 'microsoft' || v === 'outlook' || v === 'office365') return 'microsoft';
  throw new MailError('DENIED', `Unsupported provider: ${raw}`);
}

function providerHosts(provider: ProviderName): { smtpHost: string; imapHost: string } {
  if (provider === 'gmail') return { smtpHost: 'smtp.gmail.com', imapHost: 'imap.gmail.com' };
  if (provider === 'microsoft') return { smtpHost: 'smtp.office365.com', imapHost: 'outlook.office365.com' };
  return { smtpHost: 'smtp.zoho.com', imapHost: 'imap.zoho.com' };
}

function getAuth(provider: ProviderName): { user: string; pass: string } {
  if (provider === 'gmail') {
    const user = (config as any).GMAIL_USER ?? process.env.GMAIL_USER;
    const pass = (config as any).GMAIL_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new MailError('AUTH', 'Missing GMAIL_USER / GMAIL_APP_PASSWORD');
    return { user, pass };
  }

  if (provider === 'microsoft') {
    // For Microsoft, we might expect Env vars for basic auth fallbacks or initial config
    const user = process.env.MICROSOFT_USER;
    const pass = process.env.MICROSOFT_APP_PASSWORD ?? ''; // Optional if using OAuth
    if (!user) throw new MailError('AUTH', 'Missing MICROSOFT_USER');
    return { user, pass };
  }

  const user = (config as any).ZOHO_USER ?? process.env.ZOHO_USER;
  const pass = (config as any).ZOHO_APP_PASSWORD ?? process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) throw new MailError('AUTH', 'Missing ZOHO_USER / ZOHO_APP_PASSWORD');
  return { user, pass };
}

export function getAuthenticatedMailboxUser(provider: ProviderName): string {
  return getAuth(provider).user;
}

export function getImapConfig(provider: ProviderName) {
  const hosts = providerHosts(provider);
  const auth = getAuth(provider);
  return {
    host: hosts.imapHost,
    port: 993,
    secure: true,
    auth,
  };
}

export function getSmtpConfig(provider: ProviderName) {
  const hosts = providerHosts(provider);
  const auth = getAuth(provider);

  if (provider === 'microsoft') {
    // Respect env overrides for Microsoft SMTP
    const host = process.env.MICROSOFT_SMTP_HOST || hosts.smtpHost;
    const port = process.env.MICROSOFT_SMTP_PORT ? Number(process.env.MICROSOFT_SMTP_PORT) : 587;
    // Port 465 is implicit SSL/TLS (secure=true). Port 587 is STARTTLS (secure=false).
    return {
      host,
      port,
      secure: port === 465,
      auth,
    };
  }

  return {
    host: hosts.smtpHost,
    port: 465,
    secure: true,
    auth,
  };
}

function formatFromHeader(email: string): string {
  const name = String(process.env.MAIL_FROM_NAME ?? '').trim();
  if (!name) return email;
  const safe = name.replace(/\"/g, '\\"');
  return `"${safe}" <${email}>`;
}

export async function sendSmtpMail(
  provider: ProviderName,
  input: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string | string[];
    attachments?: any[];
  }
): Promise<string> {
  const smtp = getSmtpConfig(provider);
  const mailboxUser = getAuthenticatedMailboxUser(provider);

  // HARD RULE: SMTP From MUST be the authenticated mailbox user (Zoho-safe).
  // If client sends "from", we treat it as Reply-To only.
  const from = formatFromHeader(mailboxUser);

  return await sendMail({
    ...smtp,
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: input.attachments,
    // Microsoft SMTP can be slow to connect/greet
    connectionTimeout: provider === 'microsoft' ? 60000 : undefined,
    greetingTimeout: provider === 'microsoft' ? 60000 : undefined,
    socketTimeout: provider === 'microsoft' ? 120000 : undefined,
  } as any);
}
