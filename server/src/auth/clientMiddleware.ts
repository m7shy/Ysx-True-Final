import type { Request, Response, NextFunction } from 'express';
import { verifyClientAccessToken } from './clientJwt.js';

export interface ClientAuthContext {
  clientUserId: string;
  clientId: string;
  userId: string; // agency owner (tenant)
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientAuth?: ClientAuthContext;
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
 * Gate for every client-portal route. Only accepts aud:'client' access tokens
 * (a CRM token is rejected here, and vice versa). Handlers must read the scope
 * from req.clientAuth and additionally filter every query by clientId — the
 * token alone never selects rows.
 */
export function requireClientAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ code: 'AUTH', message: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const claims = verifyClientAccessToken(token);
    req.clientAuth = {
      clientUserId: claims.sub,
      clientId: claims.clientId,
      userId: claims.userId,
      email: claims.email,
    };
    next();
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired access token' });
  }
}

/** Read the authenticated client scope, or throw if the route wasn't gated. */
export function requireClientCtx(req: Request): ClientAuthContext {
  if (!req.clientAuth?.clientId) {
    throw new Error('requireClientCtx called on an unauthenticated request (missing requireClientAuth?)');
  }
  return req.clientAuth;
}
