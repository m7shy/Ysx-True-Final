import type { Request, Response, NextFunction } from 'express';
import { ClientStatus } from '@prisma/client';
import { verifyClientAccessToken } from './clientJwt.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

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
 *
 * Also enforces Client.status === ACTIVE on every request. This can't be
 * baked into the JWT (an already-issued access token would keep working
 * until it naturally expired), so it costs one indexed lookup by id here —
 * the only DB round-trip this middleware makes. Only mounted on /api/portal,
 * not /api/portal/auth: an archived client's users can therefore still LOG IN
 * (the auth routes do not check Client.status) and receive a token, and are
 * then refused by every data route. No data is exposed either way; the check
 * simply is not a login gate.
 */
export async function requireClientAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ code: 'AUTH', message: 'Missing or malformed Authorization header' });
    return;
  }

  let claims;
  try {
    claims = verifyClientAccessToken(token);
  } catch {
    res.status(401).json({ code: 'AUTH', message: 'Invalid or expired access token' });
    return;
  }

  try {
    const client = await prisma.client.findUnique({
      where: { id: claims.clientId },
      select: { status: true },
    });
    if (!client || client.status !== ClientStatus.ACTIVE) {
      res.status(403).json({ code: 'ACCESS_DENIED', message: 'This portal account is no longer active' });
      return;
    }
  } catch (err) {
    logger.error({ err, clientId: claims.clientId }, 'Client status lookup failed');
    res.status(503).json({ code: 'DB_UNAVAILABLE', message: 'Could not verify portal access' });
    return;
  }

  req.clientAuth = {
    clientUserId: claims.sub,
    clientId: claims.clientId,
    userId: claims.userId,
    email: claims.email,
  };
  next();
}

/** Read the authenticated client scope, or throw if the route wasn't gated. */
export function requireClientCtx(req: Request): ClientAuthContext {
  if (!req.clientAuth?.clientId) {
    throw new Error('requireClientCtx called on an unauthenticated request (missing requireClientAuth?)');
  }
  return req.clientAuth;
}
