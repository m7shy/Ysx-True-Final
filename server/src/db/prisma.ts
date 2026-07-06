import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

/**
 * Prisma client singleton.
 *
 * `tsx watch` (dev) and test runners re-evaluate modules on every change, which
 * would otherwise spin up a fresh PrismaClient — and a fresh connection pool —
 * on each reload until Neon/Postgres refuses new connections. Caching the client
 * on `globalThis` keeps a single pool alive across reloads. In production the
 * module is evaluated once, so the global cache is skipped.
 *
 * Connection URLs are resolved by Prisma from the datasource block in
 * prisma/schema.prisma (DATABASE_URL = pooled, DIRECT_URL = direct for migrations).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
