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
import { setPortalRefreshCookie, clearPortalRefreshCookie, PORTAL_REFRESH_COOKIE } from '../auth/cookies.js';

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

// Body-supplied refresh token: accepted as a transitional fallback so that
// clients running a stale cached bundle (pre-cookie migration) can still
// refresh. Prefer the cookie when both are present. Remove this fallback
// once every active bundle has been updated.
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
  // Set the refresh token as an HttpOnly cookie — it never appears in the
  // response body again so script cannot exfiltrate it.
  const refreshToken = signClientRefreshToken(tokenInput(cu));
  setPortalRefreshCookie(res, refreshToken);
  res.status(status).json({
    accessToken: signClientAccessToken(tokenInput(cu)),
    clientUser: { id: cu.id, email: cu.email },
    client,
  });
}

/** POST /api/portal/auth/login — email + password. */
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password } = parsed.data;

  // Portal emails are unique per AGENCY, not globally, so one address can hold
  // portal access at more than one agency. The portal is served from a single
  // origin and the request carries no tenant context, so the account is
  // resolved by which one the password actually verifies against.
  const candidates = await prisma.clientUser.findMany({ where: { email } });
  const matches = [];
  for (const candidate of candidates) {
    if (candidate.passwordHash && (await verifyPassword(password, candidate.passwordHash))) {
      matches.push(candidate);
    }
  }

  if (matches.length !== 1) {
    // Zero matches is a normal failed login. More than one means the same
    // address AND password exist at two agencies — genuinely ambiguous, and
    // guessing a tenant would be logging someone into the wrong company's
    // data. Both return the same generic error so neither case is
    // distinguishable from outside.
    if (matches.length > 1) {
      logger.warn({ email }, 'Ambiguous portal login: same credentials at multiple agencies; refusing to guess');
    }
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  const cu = matches[0];
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
  // findMany, not findUnique: portal emails are unique per agency, so this
  // address may hold access at more than one. Each gets its own link; the
  // recipient picks the right agency by clicking the one they expect.
  const accounts = await prisma.clientUser.findMany({ where: { email: parsed.data.email } });

  // Respond immediately so all callers see the same latency regardless of
  // whether the address has portal access. The mint+send work below is
  // deliberately fire-and-forget.
  res.json({ ok: true, message: 'If that email has portal access, a sign-in link is on its way.' });

  if (accounts.length === 0) return;

  // Detached: must never rethrow (process backstop is a last resort, not a
  // substitute for an explicit catch here).
  void (async () => {
    for (const cu of accounts) {
      try {
        // If the client already has an unexpired magic-link token (e.g. they
        // clicked "send again" immediately), don't burn another email quota
        // slot or land a second identical link in their inbox. Per-account, so
        // one agency's pending token does not suppress another's link.
        const alreadyPending = await hasUnexpiredMagicLink(cu.id);
        if (alreadyPending) continue;

        const raw = await createLoginToken(cu.id, 'MAGIC_LINK');
        const link = `${portalBaseUrl()}/login?token=${raw}`;
        await sendPortalEmail(cu.userId, {
          to: cu.email,
          subject: 'Your YSX Visuals sign-in link',
          text: `Click to sign in to your client portal (valid for 15 minutes):\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        });
      } catch (err) {
        // One agency's send failing must not suppress the others.
        logger.error({ err, clientUserId: cu.id }, 'Failed to send magic link');
      }
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

/**
 * POST /api/portal/auth/refresh — rotate the token pair; rejects bumped tokenVersion.
 *
 * Reads the refresh token from the HttpOnly cookie (preferred) or the request
 * body (transitional fallback for clients running a pre-cookie bundle).
 */
router.post('/refresh', async (req: Request, res: Response) => {
  // Prefer the cookie; fall back to the body for one release so users with a
  // stale cached bundle are not hard-locked out.
  const rawToken: string | undefined =
    req.cookies?.[PORTAL_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!rawToken) {
    res.status(400).json({ code: 'VALIDATION', message: 'refreshToken is required' });
    return;
  }

  let claims;
  try {
    claims = verifyClientRefreshToken(rawToken);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired refresh token' });
    return;
  }

  const cu = await prisma.clientUser.findUnique({ where: { id: claims.sub } });
  if (!cu || cu.tokenVersion !== claims.ver) {
    res.status(401).json({ code: 'AUTH', message: 'Refresh token has been revoked' });
    return;
  }

  const refreshToken = signClientRefreshToken(tokenInput(cu));
  setPortalRefreshCookie(res, refreshToken);
  res.json({
    accessToken: signClientAccessToken(tokenInput(cu)),
  });
});

export default router;
