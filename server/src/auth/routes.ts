import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.js';
import { requireAuth, requireUserId } from './middleware.js';
import { setCrmRefreshCookie, clearCrmRefreshCookie, CRM_REFRESH_COOKIE } from './cookies.js';
import {
  recordRefreshToken,
  consumeRefreshToken,
  revokeAllForSubject,
  revokeFamilyForToken,
} from './refreshStore.js';

const router = express.Router();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Body-supplied refresh token: accepted as a transitional fallback so that
// clients running a stale cached bundle (pre-cookie migration) can still
// refresh. Prefer the cookie when both are present. Remove this fallback
// once every active bundle has been updated.
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

function issueTokens(user: { id: string; email: string; tokenVersion: number }) {
  return {
    accessToken: signAccessToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion }),
    refreshToken: signRefreshToken({
      userId: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    }),
  };
}

/**
 * Set the refresh token as an HttpOnly cookie and return only the access
 * token (plus any extra fields) in the JSON body. The refresh token never
 * appears in a response body again — script cannot read it from a cookie.
 *
 * Also records the token server-side. `familyId` continues an existing session
 * chain (a rotation); omitting it opens a new one (a login). Without the
 * record, /refresh will not accept the token at all — that is what makes a
 * stolen token expire on first reuse instead of in thirty days.
 */
async function issueTokensWithCookie(
  res: Response,
  user: { id: string; email: string; tokenVersion: number },
  familyId?: string,
): Promise<{ accessToken: string }> {
  const { accessToken, refreshToken } = issueTokens(user);
  await recordRefreshToken({ userId: user.id }, refreshToken, familyId);
  setCrmRefreshCookie(res, refreshToken);
  return { accessToken };
}

function publicUser(user: { id: string; email: string; createdAt: Date; lastLoginAt: Date | null }) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function badRequest(res: Response, err: z.ZodError): void {
  res.status(400).json({
    code: 'VALIDATION',
    message: err.issues.map((i) => i.message).join('; '),
  });
}

/**
 * POST /api/auth/signup
 * Create a tenant (User) and return a token pair.
 */
router.post('/signup', async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, lastLoginAt: new Date() },
  });

  logger.info({ userId: user.id }, 'User signed up');
  res.status(201).json({ user: publicUser(user), ...(await issueTokensWithCookie(res, user)) });
});

/**
 * POST /api/auth/login
 * Verify credentials and return a token pair. Errors are intentionally generic
 * to avoid leaking whether an email is registered.
 */
router.post('/login', async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  logger.info({ userId: user.id }, 'User logged in');
  res.json({ user: publicUser(updated), ...(await issueTokensWithCookie(res, updated)) });
});

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a fresh token pair. Rejects tokens whose
 * `ver` no longer matches User.tokenVersion (invalidated everywhere).
 *
 * Reads the refresh token from the HttpOnly cookie (preferred) or the request
 * body (transitional fallback for clients running a pre-cookie bundle).
 */
router.post('/refresh', async (req: Request, res: Response) => {
  // Cookie ONLY. The body fallback that lived here was a transitional shim for
  // clients still running a pre-cookie bundle; that transition is complete —
  // the cookie migration deployed and forced a one-time logout for every user,
  // so no live client sends a body token any more.
  //
  // It is deliberately gone rather than merely unused: while it stood, the
  // HttpOnly migration bought nothing. Any refresh token exfiltrated from
  // localStorage before the migration (or via any XSS since) stayed fully
  // usable by POSTing it as JSON from any context. CORS does not help — it
  // governs who may READ a cross-origin response, not who may send a request,
  // and a server-side script is unconstrained either way.
  const rawToken: string | undefined = req.cookies?.[CRM_REFRESH_COOKIE];

  if (!rawToken) {
    res.status(400).json({ code: 'VALIDATION', message: 'refreshToken is required' });
    return;
  }

  let claims;
  try {
    claims = verifyRefreshToken(rawToken);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired refresh token' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.tokenVersion !== claims.ver) {
    res.status(401).json({ code: 'AUTH', message: 'Refresh token has been revoked' });
    return;
  }

  // Rotation + reuse detection. A valid signature is no longer sufficient: the
  // token must also be a live, unconsumed server-side record.
  const rotation = await consumeRefreshToken(rawToken);

  if (rotation.status === 'reused') {
    // Two parties hold this token. consumeRefreshToken has already revoked the
    // whole family, so every device on this login chain must sign in again.
    // The cookie is cleared here so this browser stops replaying a token that
    // will never work again.
    clearCrmRefreshCookie(res);
    logger.warn({ userId: user.id }, 'Refresh reuse detected; session family revoked');
    res.status(401).json({
      code: 'AUTH',
      message: 'This session was ended for security reasons. Please sign in again.',
    });
    return;
  }

  if (rotation.status === 'invalid') {
    // Unknown, revoked or expired. Also every session that predates rotation —
    // hence the one-time logout on the deploy that introduces this.
    clearCrmRefreshCookie(res);
    res.status(401).json({ code: 'AUTH', message: 'Refresh token has been revoked' });
    return;
  }

  // Successor stays in the same family, so the chain remains traceable.
  res.json(await issueTokensWithCookie(res, user, rotation.familyId));
});

/**
 * POST /api/auth/logout-all
 * Bump tokenVersion so every access/refresh token issued before this call —
 * including the one used to call it — stops verifying (tenantGate.ts and the
 * /refresh handler above both check `ver` against this column).
 */
/**
 * POST /api/auth/logout — end THIS session.
 *
 * This route did not exist. The SPA has always POSTed to it on sign-out and
 * swallowed the resulting 404 (`.catch(() => {})` in AuthContext), so the
 * HttpOnly refresh cookie was never cleared: "Sign out" dropped the in-memory
 * access token, and the very next page load silently re-authenticated through
 * the boot-time refresh. On a shared browser the next person to open the app
 * was signed in as the previous user, for as long as the refresh token lived.
 *
 * This is a regression introduced by moving refresh tokens out of localStorage:
 * before that, clearing local storage on logout genuinely destroyed the token.
 *
 * Deliberately NOT behind requireAuth: signing out must work even when the
 * access token has already expired, and there is nothing to authorize —
 * clearing your own cookie is not a privileged action. Also deliberately does
 * NOT bump tokenVersion; that is logout-all's job, and doing it here would sign
 * the user out of every other device whenever they closed one tab.
 */
router.post('/logout', async (req: Request, res: Response) => {
  // Revoke the session chain server-side as well as clearing the cookie.
  // Clearing the cookie alone only stops THIS browser from presenting the
  // token; anyone who had already copied it could keep refreshing with it
  // until it expired. Revoking the family makes sign-out mean it.
  const rawToken: string | undefined = req.cookies?.[CRM_REFRESH_COOKIE];
  if (rawToken) await revokeFamilyForToken(rawToken);
  clearCrmRefreshCookie(res);
  res.json({ ok: true });
});

router.post('/logout-all', requireAuth, async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  // Belt and braces: the tokenVersion bump already invalidates every issued
  // JWT, but revoking the stored records too means the refresh table reflects
  // reality rather than holding rows that look live.
  await revokeAllForSubject({ userId });
  // Clear the refresh-token cookie so the browser stops sending a now-invalid
  // token on future refresh attempts.
  clearCrmRefreshCookie(res);
  logger.info({ userId }, 'User logged out of all sessions');
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  // Reuse signup's exact rule rather than re-deriving it — one minimum length
  // to keep in sync, not two.
  newPassword: credentialsSchema.shape.password,
});

/**
 * POST /api/auth/change-password
 * Verifies the current password, then writes the new hash and bumps
 * tokenVersion in the SAME update so a password change evicts every other
 * session. That also invalidates the token the caller used to get here, so
 * we hand back a fresh pair — otherwise the user would be logged out of the
 * very tab that just changed their password.
 */
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    return;
  }

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
  // Every stored session dies with the password, including this caller's — the
  // fresh pair issued below opens a NEW family, so the tab that changed the
  // password stays signed in without inheriting the old chain.
  await revokeAllForSubject({ userId });

  logger.info({ userId }, 'User changed password (all other sessions evicted)');
  res.json({ user: publicUser(updated), ...(await issueTokensWithCookie(res, updated)) });
});

/**
 * GET /api/auth/me
 * Return the authenticated tenant's profile. Used by the frontend to hydrate
 * the session from a stored access token.
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    return;
  }
  res.json({ user: publicUser(user) });
});

export default router;
