import express, { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.js';
import { requireAuth, requireUserId } from './middleware.js';

const router = express.Router();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

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
  res.status(201).json({ user: publicUser(user), ...issueTokens(user) });
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
  res.json({ user: publicUser(updated), ...issueTokens(updated) });
});

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a fresh token pair. Rejects tokens whose
 * `ver` no longer matches User.tokenVersion (invalidated everywhere).
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  let claims;
  try {
    claims = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired refresh token' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.tokenVersion !== claims.ver) {
    res.status(401).json({ code: 'AUTH', message: 'Refresh token has been revoked' });
    return;
  }

  res.json(issueTokens(user));
});

/**
 * POST /api/auth/logout-all
 * Bump tokenVersion so every access/refresh token issued before this call —
 * including the one used to call it — stops verifying (tenantGate.ts and the
 * /refresh handler above both check `ver` against this column).
 */
router.post('/logout-all', requireAuth, async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
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

  logger.info({ userId }, 'User changed password (all other sessions evicted)');
  res.json({ user: publicUser(updated), ...issueTokens(updated) });
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
