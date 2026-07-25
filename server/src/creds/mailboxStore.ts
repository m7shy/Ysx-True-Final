import { MailboxProvider, type Mailbox } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { MailError } from '../httpErrors.js';
import { maskEmail } from '../util/redact.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { refreshAccessToken, type OAuthProvider, type RefreshResult } from './oauth.js';

/**
 * DB-backed, per-tenant mailbox credential store.
 *
 * Replaces the previous global process.env single-user configuration
 * (GMAIL_USER / ZOHO_USER / MICROSOFT_USER ...). Credentials now live on the
 * `Mailbox` model, scoped to a `userId`, with OAuth tokens encrypted at rest.
 * Every resolver takes a userId so one tenant can never use another's mailbox.
 */

// The wire/provider name used across the mail layer. Zoho is intentionally
// unsupported here: Phase 1 dropped it from the schema (MailboxProvider has no
// ZOHO slot), so there is nothing to resolve from the database.
export type WireProvider = 'gmail' | 'microsoft' | 'zoho';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh when <=5 min of life remains

// Module-level single-flight map to serialize concurrent token refreshes per mailbox id.
const inFlightRefreshes = new Map<string, Promise<string>>();

export interface MailboxConnection {
  mailboxId: string;
  email: string;
  provider: OAuthProvider;
  accessToken: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

function toEnumProvider(provider: WireProvider): MailboxProvider {
  if (provider === 'gmail') return MailboxProvider.GMAIL;
  if (provider === 'microsoft') return MailboxProvider.MICROSOFT;
  throw new MailError('DENIED', `Provider "${provider}" is not supported; connect a Gmail or Microsoft mailbox.`);
}

function toWireProvider(provider: MailboxProvider): OAuthProvider {
  return provider === MailboxProvider.GMAIL ? 'gmail' : 'microsoft';
}

function hosts(provider: OAuthProvider) {
  if (provider === 'gmail') {
    return {
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
    };
  }
  // Microsoft 365 / Outlook. SMTP 587 uses STARTTLS (secure=false).
  return {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  };
}

/** Load a tenant's active mailbox for a provider, or throw a clear error. */
export async function getActiveMailbox(userId: string, provider: WireProvider): Promise<Mailbox> {
  const enumProvider = toEnumProvider(provider);
  const mailbox = await prisma.mailbox.findFirst({
    where: { userId, provider: enumProvider, isActive: true },
    orderBy: { lastSentAt: 'asc' }, // fair round-robin when a tenant has several
  });
  if (!mailbox) {
    throw new MailError('AUTH', `No active ${provider} mailbox is connected for this account.`);
  }
  return mailbox;
}

/**
 * Return a usable (fresh) access token for a mailbox, refreshing + persisting
 * the rotated tokens when the current one is within the 5-minute buffer.
 */
export async function ensureFreshAccessToken(mailbox: Mailbox): Promise<string> {
  const provider = toWireProvider(mailbox.provider);

  const notExpiring =
    mailbox.expiresAt != null && mailbox.expiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS;

  if (notExpiring && mailbox.accessToken) {
    return decryptSecret(mailbox.accessToken);
  }

  if (!mailbox.refreshToken) {
    throw new MailError('AUTH', `Mailbox ${maskEmail(mailbox.email)} has no refresh token; reconnect it.`);
  }

  // Deduplicate concurrent refreshes for the same mailbox id so multiple
  // callers awaiting a refresh don't race and rotate single-use tokens out
  // from under each other.
  const existingInFlight = inFlightRefreshes.get(mailbox.id);
  if (existingInFlight) {
    const token = await existingInFlight;
    // Re-check freshness after awaiting single-flight in case DB was updated.
    const freshMb = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
    if (freshMb?.accessToken) {
      const isFresh =
        freshMb.expiresAt != null && freshMb.expiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS;
      if (isFresh) {
        return decryptSecret(freshMb.accessToken);
      }
    }
    return token;
  }

  const refreshPromise = (async (): Promise<string> => {
    // Re-check DB in case a recent refresh updated the stored tokens before we acquired execution.
    const currentMb = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
    const mb = currentMb ?? mailbox;

    const isCurrentFresh =
      mb.expiresAt != null && mb.expiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS;

    if (isCurrentFresh && mb.accessToken) {
      return decryptSecret(mb.accessToken);
    }

    if (!mb.refreshToken) {
      throw new MailError('AUTH', `Mailbox ${maskEmail(mb.email)} has no refresh token; reconnect it.`);
    }

    const refreshTokenPlain = decryptSecret(mb.refreshToken);
    let result: RefreshResult;
    try {
      result = await refreshAccessToken(provider, {
        refreshToken: refreshTokenPlain,
        tenant: mb.tenant,
        scope: mb.scope ?? undefined,
      });
    } catch (err) {
      if (err instanceof MailError && err.revoked) {
        // Corroborate before writing isActive: false. Re-read the database row to
        // check whether another caller or background task rotated the refresh
        // token concurrently.
        const latest = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
        if (latest && latest.refreshToken === mb.refreshToken) {
          // Grant is truly revoked — stored refresh token matches the failed one.
          // TODO: Mailbox model lacks a deactivatedReason/errorReason column to store why it was disabled; set it here once a schema migration adds the field.
          await prisma.mailbox.update({ where: { id: mailbox.id }, data: { isActive: false } });
          logger.warn(
            { user: maskEmail(mailbox.email), provider },
            'Mailbox OAuth grant revoked — disabled; user must reconnect',
          );
          throw new MailError(
            'AUTH',
            `Mailbox ${maskEmail(mailbox.email)} access was revoked; reconnect it to resume sending.`,
            true,
          );
        } else if (latest?.accessToken) {
          // Stored refresh token changed: another caller succeeded in rotating tokens.
          // Do not deactivate; return the newly stored access token instead.
          logger.info(
            { user: maskEmail(mailbox.email), provider },
            'OAuth refresh failed on stale token, but concurrent refresh succeeded; returning fresh token',
          );
          return decryptSecret(latest.accessToken);
        }
      }
      throw err;
    }

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        accessToken: encryptSecret(result.accessToken),
        // Only rotate the refresh token when the provider returned a new one.
        ...(result.refreshToken ? { refreshToken: encryptSecret(result.refreshToken) } : {}),
        scope: result.scope ?? mb.scope,
        obtainedAt: new Date(),
        expiresAt: result.expiresAt,
      },
    });

    logger.debug({ user: maskEmail(mailbox.email), provider }, 'Refreshed mailbox OAuth token');
    return result.accessToken;
  })();

  inFlightRefreshes.set(mailbox.id, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inFlightRefreshes.delete(mailbox.id);
  }
}

/**
 * Resolve everything the IMAP/SMTP layer needs for a tenant + provider:
 * hosts, ports, the sending identity, and a fresh XOAUTH2 access token.
 */
export async function getMailboxConnection(userId: string, provider: WireProvider): Promise<MailboxConnection> {
  const mailbox = await getActiveMailbox(userId, provider);
  const wire = toWireProvider(mailbox.provider);
  const accessToken = await ensureFreshAccessToken(mailbox);
  return {
    mailboxId: mailbox.id,
    email: mailbox.email,
    provider: wire,
    accessToken,
    ...hosts(wire),
  };
}

/** UTC start-of-day for the daily send counter window. */
function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** sentToday, treating a stale counterDate (previous UTC day) as a reset. */
function effectiveSentToday(mailbox: Mailbox, today = utcDayStart()): number {
  return mailbox.counterDate.getTime() < today.getTime() ? 0 : mailbox.sentToday;
}

/**
 * Inbox rotation: pick the tenant's active mailbox (any provider) that is
 * under its daily limit and was used least recently, so campaign volume is
 * spread evenly across all connected inboxes. Returns null when every
 * mailbox is exhausted or unwarmed (dailyLimit 0).
 */
export async function pickRotationMailbox(userId: string): Promise<Mailbox | null> {
  const today = utcDayStart();
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, isActive: true },
    orderBy: { lastSentAt: { sort: 'asc', nulls: 'first' } },
  });
  return (
    mailboxes.find(
      (m) => m.dailyLimit > 0 && effectiveSentToday(m, today) < m.dailyLimit,
    ) ?? null
  );
}

/** Record a completed send against a mailbox's daily counter + LRU cursor. */
export async function recordMailboxSend(mailbox: Mailbox): Promise<void> {
  const today = utcDayStart();
  const stale = mailbox.counterDate.getTime() < today.getTime();
  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: {
      sentToday: stale ? 1 : { increment: 1 },
      ...(stale ? { counterDate: today } : {}),
      lastSentAt: new Date(),
    },
  });
}

/** Resolve IMAP/SMTP connection details for a SPECIFIC mailbox row. */
export async function connectionForMailbox(mailbox: Mailbox): Promise<MailboxConnection> {
  const wire = toWireProvider(mailbox.provider);
  const accessToken = await ensureFreshAccessToken(mailbox);
  return {
    mailboxId: mailbox.id,
    email: mailbox.email,
    provider: wire,
    accessToken,
    ...hosts(wire),
  };
}

/** List a tenant's mailboxes (no secrets) — used by the health endpoint. */
export async function listMailboxes(userId: string) {
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId },
    select: { id: true, email: true, provider: true, isActive: true, expiresAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return mailboxes;
}

/**
 * Disconnect (delete) a tenant's mailbox by id. Deleting the row removes the
 * encrypted OAuth tokens entirely. Scoped by userId so one tenant can never
 * disconnect another tenant's mailbox. Returns the deleted mailbox's email,
 * or null when no such mailbox belongs to this tenant.
 */
export async function deleteMailbox(userId: string, mailboxId: string): Promise<string | null> {
  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, userId },
    select: { id: true, email: true },
  });
  if (!mailbox) return null;
  await prisma.mailbox.delete({ where: { id: mailbox.id } });
  logger.info({ user: maskEmail(mailbox.email) }, 'Disconnected mailbox');
  return mailbox.email;
}

/**
 * Create or update a tenant's mailbox credential record, encrypting the OAuth
 * tokens before they touch the database. This is the write counterpart to the
 * resolvers above; an OAuth connect/callback flow (out of scope here) calls it.
 */
export async function upsertMailbox(input: {
  userId: string;
  email: string;
  provider: WireProvider;
  accessToken: string;
  refreshToken: string;
  scope?: string;
  tenant?: string | null;
  expiresAt?: Date | null;
}): Promise<Mailbox> {
  const enumProvider = toEnumProvider(input.provider);
  const email = input.email.toLowerCase().trim();

  const data = {
    provider: enumProvider,
    accessToken: encryptSecret(input.accessToken),
    refreshToken: encryptSecret(input.refreshToken),
    scope: input.scope ?? null,
    tenant: input.tenant ?? null,
    obtainedAt: new Date(),
    expiresAt: input.expiresAt ?? null,
    isActive: true,
  };

  return prisma.mailbox.upsert({
    where: { userId_email: { userId: input.userId, email } },
    // New mailboxes start with a cold-start-safe daily send budget so campaign
    // rotation (pickRotationMailbox requires dailyLimit > 0) can use them
    // immediately. Deliberately absent from `update`: re-authenticating must
    // not clobber a user-tuned limit.
    create: { userId: input.userId, email, dailyLimit: DEFAULT_DAILY_LIMIT, ...data },
    update: data,
  });
}

/** Cold-start-safe default sends/day for a freshly connected mailbox. */
export const DEFAULT_DAILY_LIMIT = 30;

export interface MailboxSettings {
  id: string;
  email: string;
  provider: WireProvider;
  isActive: boolean;
  dailyLimit: number;
  sentToday: number;
  lastSentAt: string | null;
}

function toSettings(m: Mailbox): MailboxSettings {
  return {
    id: m.id,
    email: m.email,
    provider: toWireProvider(m.provider),
    isActive: m.isActive,
    dailyLimit: m.dailyLimit,
    sentToday: effectiveSentToday(m),
    lastSentAt: m.lastSentAt?.toISOString() ?? null,
  };
}

/** All of a tenant's mailboxes with their rotation settings (no secrets). */
export async function listMailboxSettings(userId: string): Promise<MailboxSettings[]> {
  const rows = await prisma.mailbox.findMany({ where: { userId }, orderBy: { email: 'asc' } });
  return rows.map(toSettings);
}

/** Update a tenant-owned mailbox's rotation settings. Returns null if not theirs. */
export async function updateMailboxSettings(
  userId: string,
  mailboxId: string,
  patch: { dailyLimit?: number; isActive?: boolean },
): Promise<MailboxSettings | null> {
  const existing = await prisma.mailbox.findFirst({ where: { id: mailboxId, userId } });
  if (!existing) return null;
  const updated = await prisma.mailbox.update({
    where: { id: existing.id },
    data: {
      ...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
  });
  return toSettings(updated);
}
