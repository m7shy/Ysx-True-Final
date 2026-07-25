import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  signClientAccessToken,
  signClientRefreshToken,
  verifyClientRefreshToken,
  type ClientTokenInput,
} from '../auth/clientJwt.js';
import { createLoginToken, consumeLoginToken, hasUnexpiredMagicLink } from './tokens.js';
import { sendPortalEmail, portalBaseUrl } from './mailer.js';

/**
 * Client-portal auth: password login, passwordless magic link, invite/set-
 * password, refresh. Unauthenticated by design (mounted behind its own tight
 * rate limiter in index.ts). Every response that could reveal whether an email
 * exists is deliberately uniform.
 */

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
});

const tokenSchema = z.object({ token: z.string().min(1, 'token is required') });

const setPasswordSchema = z.object({
  token: z.string().min(1, 'token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1, 'refreshToken is required') });

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({ code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') });
}

type ClientUserRow = {
  id: string;
  clientId: string;
  userId: string;
  email: string;
  tokenVersion: number;
};

function tokenInput(cu: ClientUserRow): ClientTokenInput {
  return {
    clientUserId: cu.id,
    clientId: cu.clientId,
    userId: cu.userId,
    email: cu.email,
    tokenVersion: cu.tokenVersion,
  };
}

async function issueSession(cu: ClientUserRow, res: Response, status = 200): Promise<void> {
  await prisma.clientUser.update({ where: { id: cu.id }, data: { lastLoginAt: new Date() } });
  const client = await prisma.client.findUnique({
    where: { id: cu.clientId },
    select: { id: true, name: true, companyName: true },
  });
  res.status(status).json({
    accessToken: signClientAccessToken(tokenInput(cu)),
    refreshToken: signClientRefreshToken(tokenInput(cu)),
    clientUser: { id: cu.id, email: cu.email },
    client,
  });
}

/** POST /api/portal/auth/login — email + password. */
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password } = parsed.data;
  const cu = await prisma.clientUser.findUnique({ where: { email } });
  const ok = cu?.passwordHash ? await verifyPassword(password, cu.passwordHash) : false;
  if (!cu || !ok) {
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  logger.info({ clientUserId: cu.id }, 'Client logged in (password)');
  await issueSession(cu, res);
});

/**
 * POST /api/portal/auth/magic-link — request a passwordless login link.
 *
 * Security properties maintained:
 *   1. Uniform response body + status on every path — no account enumeration.
 *   2. Respond BEFORE doing any token-mint/send work so that response latency
 *      is O(1 indexed DB read) for every caller, not O(SMTP round-trip) for
 *      known addresses. This eliminates the timing oracle that let an attacker
 *      reliably distinguish "email exists" from "email unknown".
 *   3. If a valid, unused MAGIC_LINK token already exists for this account we
 *      silently skip minting a second one. This prevents an authenticated-IP
 *      attacker from burning the tenant's paid email quota through repeated
 *      requests, while still letting the user click the original link.
 */
router.post('/magic-link', async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  // Single indexed lookup — same cost for existing and nonexistent addresses.
  const cu = await prisma.clientUser.findUnique({ where: { email: parsed.data.email } });

  // Respond immediately so all callers see the same latency regardless of
  // whether the address has portal access. The mint+send work below is
  // deliberately fire-and-forget.
  res.json({ ok: true, message: 'If that email has portal access, a sign-in link is on its way.' });

  if (!cu) return;

  // Detached: must never rethrow (process backstop is a last resort, not a
  // substitute for an explicit catch here).
  void (async () => {
    try {
      // If the client already has an unexpired magic-link token (e.g. they
      // clicked "send again" immediately), don't burn another email quota slot
      // or land a second identical link in their inbox.
      const alreadyPending = await hasUnexpiredMagicLink(cu.id);
      if (alreadyPending) return;

      const raw = await createLoginToken(cu.id, 'MAGIC_LINK');
      const link = `${portalBaseUrl()}/login?token=${raw}`;
      await sendPortalEmail(cu.userId, {
        to: cu.email,
        subject: 'Your YSX Visuals sign-in link',
        text: `Click to sign in to your client portal (valid for 15 minutes):\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
      });
    } catch (err) {
      logger.error({ err, clientUserId: cu.id }, 'Failed to send magic link');
    }
  })();
});

/** POST /api/portal/auth/magic-link/consume — exchange the emailed token for a session. */
router.post('/magic-link/consume', async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const cu = await consumeLoginToken(parsed.data.token, 'MAGIC_LINK');
  if (!cu) {
    res.status(401).json({ code: 'AUTH', message: 'This sign-in link is invalid or has expired — request a new one' });
    return;
  }

  logger.info({ clientUserId: cu.id }, 'Client logged in (magic link)');
  await issueSession(cu, res);
});

/**
 * POST /api/portal/auth/set-password — consume an INVITE token, set the first
 * password, and log straight in (the invite doubles as first login).
 */
router.post('/set-password', async (req: Request, res: Response) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const cu = await consumeLoginToken(parsed.data.token, 'INVITE');
  if (!cu) {
    res.status(401).json({ code: 'AUTH', message: 'This invite link is invalid or has expired — ask for a new invite' });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  // Bump tokenVersion alongside the password write — setting a new password
  // (e.g. after a suspected compromise) must evict any session an attacker
  // already holds, not just block them from logging in again.
  const updated = await prisma.clientUser.update({
    where: { id: cu.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  logger.info({ clientUserId: cu.id }, 'Client set password via invite');
  // Issue from the UPDATED row, not the pre-update one: the bump above means a
  // session minted from the stale tokenVersion would carry ver=N while the DB
  // holds N+1, so the client's first refresh would 401 and log them straight
  // back out.
  await issueSession(updated, res, 201);
});

/** POST /api/portal/auth/refresh — rotate the token pair; rejects bumped tokenVersion. */
router.post('/refresh', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  let claims;
  try {
    claims = verifyClientRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired refresh token' });
    return;
  }

  const cu = await prisma.clientUser.findUnique({ where: { id: claims.sub } });
  if (!cu || cu.tokenVersion !== claims.ver) {
    res.status(401).json({ code: 'AUTH', message: 'Refresh token has been revoked' });
    return;
  }

  res.json({
    accessToken: signClientAccessToken(tokenInput(cu)),
    refreshToken: signClientRefreshToken(tokenInput(cu)),
  });
});

export default router;
