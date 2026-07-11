import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt.js';

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
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ code: 'AUTH', message: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.auth = { userId: claims.sub, email: claims.email, tokenVersion: claims.ver };
    next();
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired access token' });
  }
}

/** Read the authenticated tenant, or throw if the route wasn't gated. */
export function requireUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new Error('requireUserId called on an unauthenticated request (missing requireAuth?)');
  }
  return req.auth.userId;
}
