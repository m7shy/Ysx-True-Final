import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * JWT issuance/verification for CLIENT PORTAL sessions (ClientUser), fully
 * separate from the CRM's jwt.ts on purpose: portal tokens carry aud:'client'
 * and are only accepted by requireClientAuth, so a portal token can never
 * authorize a CRM route and a CRM token can never authorize a portal route.
 * Shares the signing secret — the audience claim is the boundary.
 */

const CLIENT_AUD = 'client';

export interface ClientAccessTokenClaims {
  sub: string; // clientUserId
  clientId: string;
  userId: string; // agency owner (tenant)
  email: string;
  aud: typeof CLIENT_AUD;
  typ: 'access';
}

export interface ClientRefreshTokenClaims {
  sub: string; // clientUserId
  clientId: string;
  userId: string;
  email: string;
  ver: number; // ClientUser.tokenVersion snapshot
  aud: typeof CLIENT_AUD;
  typ: 'refresh';
}

const DEV_FALLBACK_SECRET = 'dev-insecure-jwt-secret-do-not-use-in-production';
let warnedDevSecret = false;

function getSecret(): string {
  if (config.JWT_SECRET) return config.JWT_SECRET;
  if (config.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  if (!warnedDevSecret) {
    logger.warn('JWT_SECRET not set — using an insecure dev fallback secret.');
    warnedDevSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

function signOptions(expiresIn: string): jwt.SignOptions {
  return { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
}

export interface ClientTokenInput {
  clientUserId: string;
  clientId: string;
  userId: string;
  email: string;
  tokenVersion: number;
}

export function signClientAccessToken(input: ClientTokenInput): string {
  const claims: ClientAccessTokenClaims = {
    sub: input.clientUserId,
    clientId: input.clientId,
    userId: input.userId,
    email: input.email,
    aud: CLIENT_AUD,
    typ: 'access',
  };
  return jwt.sign(claims, getSecret(), signOptions(config.JWT_ACCESS_TTL));
}

export function signClientRefreshToken(input: ClientTokenInput): string {
  const claims: ClientRefreshTokenClaims = {
    sub: input.clientUserId,
    clientId: input.clientId,
    userId: input.userId,
    email: input.email,
    ver: input.tokenVersion,
    aud: CLIENT_AUD,
    typ: 'refresh',
  };
  return jwt.sign(claims, getSecret(), signOptions(config.JWT_REFRESH_TTL));
}

function verifyClient(token: string, typ: 'access' | 'refresh'): jwt.JwtPayload {
  // audience is enforced by jwt.verify itself; typ is checked below.
  const decoded = jwt.verify(token, getSecret(), { audience: CLIENT_AUD });
  if (typeof decoded === 'string' || decoded.typ !== typ || decoded.aud !== CLIENT_AUD) {
    throw new Error(`Not a client ${typ} token`);
  }
  return decoded;
}

export function verifyClientAccessToken(token: string): ClientAccessTokenClaims {
  return verifyClient(token, 'access') as unknown as ClientAccessTokenClaims;
}

export function verifyClientRefreshToken(token: string): ClientRefreshTokenClaims {
  return verifyClient(token, 'refresh') as unknown as ClientRefreshTokenClaims;
}
