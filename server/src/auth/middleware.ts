import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

export interface AuthContext {
  userId: string;
  email: string;
  tokenVersion?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Gate for every tenant-scoped route. Requires a valid Bearer access token and
 * attaches { userId, email } to req.auth. Downstream handlers must read the
 * tenant from req.auth — never from a request body/query — so one user can
 * never act on another user's data or mailboxes.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ code: 'AUTH', message: 'Missing or malformed Authorization header' });
    return;
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired access token' });
    return;
  }

  // Revocation applies to READS too, not just mutations.
  //
  // This check used to live only in requireActiveTenant, which returns early
  // for GET/HEAD/OPTIONS — so after "log out everywhere" or a password change,
  // a stolen access token kept full read access to every lead, invoice, client
  // and mailbox listing until it expired (~15 min). Those are exactly the
  // actions a user takes BECAUSE they believe a session is compromised, so
  // "contained, except we keep serving your data for 15 minutes" is not what
  // they are being promised.
  //
  // Tokens minted before the `ver` claim existed carry no version and are not
  // checked, so this cannot lock out an already-open legacy session.
  if (claims.ver !== undefined) {
    let current: number | null;
    try {
      const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { tokenVersion: true } });
      current = user?.tokenVersion ?? null;
    } catch (err) {
      // Fail closed on a DB fault: this gate is the revocation boundary, and
      // treating "cannot verify" as "allow" would reopen the window it exists
      // to close. requireActiveTenant already 503s on the same condition.
      logger.error({ err, userId: claims.sub }, 'tokenVersion lookup failed');
      res.status(503).json({ code: 'DB_UNAVAILABLE', message: 'Could not verify session' });
      return;
    }
    if (current === null) {
      res.status(401).json({ code: 'AUTH', message: 'Account no longer exists' });
      return;
    }
    if (current !== claims.ver) {
      res.status(401).json({ code: 'AUTH', message: 'Session has been revoked. Please log in again.' });
      return;
    }
  }

  req.auth = { userId: claims.sub, email: claims.email, tokenVersion: claims.ver };
  next();
}

/** Read the authenticated tenant, or throw if the route wasn't gated. */
export function requireUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new Error('requireUserId called on an unauthenticated request (missing requireAuth?)');
  }
  return req.auth.userId;
}
