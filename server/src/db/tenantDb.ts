import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Tenant-scoped Prisma client (Prisma Client Extension).
 *
 * `tenantDb(userId)` returns a client on which EVERY query against a
 * tenant-owned model is forcibly bounded to that tenant:
 *
 *   - reads / counts / aggregates get `userId` AND-merged into `where`
 *     (including findUnique — extended-where-unique allows non-unique filters),
 *   - update / updateMany / delete / deleteMany get `userId` merged into
 *     `where`, so a handler can `update({ where: { id } })` and still never
 *     touch another tenant's row (Prisma throws P2025 / matches 0 rows),
 *   - create / createMany / upsert get `userId` stamped into `data`,
 *     overriding anything the caller (or a malicious payload) put there.
 *
 * Route handlers must obtain the userId from req.auth (see requireUserId) and
 * use this client for all tenant data access instead of the raw `prisma`
 * singleton. Cross-tenant background jobs (campaign worker, reply poller,
 * scheduler tick) are the only legitimate users of the raw client.
 */

/**
 * Models that carry a `userId` tenant column. `User` itself is not scoped.
 *
 * `CookieFile` is deliberately NOT included even though it has a `userId`
 * column: legacy rows predating per-tenant scoping have `userId: null` and
 * are intentionally readable/deletable by every tenant (see
 * scraper/cookieService.ts). This extension's AND-merge would collapse that
 * `OR: [{ userId }, { userId: null }]` read pattern down to `userId`-only,
 * silently hiding every tenant's legacy cookie files. Leave CookieFile on
 * hand-written filters until the legacy-null rows are migrated to real
 * ownership, at which point it can join this set.
 */
const TENANT_MODELS = new Set<string>([
  'Lead',
  'Campaign',
  'TrackingEvent',
  'Mailbox',
  'FollowupJob',
  'CampaignRecipient',
  'ScraperSchedule',
  'Client',
  'Project',
  'Invoice',
]);

/** Operations whose `where` is a plain filter that can be AND-merged. */
const WHERE_OPS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Operations whose `where` is a WhereUniqueInput: Prisma requires the unique
 * selector (e.g. `id` or a compound alias like `userId_email`) at the TOP
 * level, so an AND-wrapper is rejected at runtime ("Unknown argument"). The
 * tenant bound is instead merged as a sibling filter field — extended
 * where-unique ANDs it with the unique selector, and the spread order means a
 * caller-supplied top-level `userId` can never override the tenant's.
 */
const UNIQUE_WHERE_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const CREATE_OPS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

function scopeWhere(where: unknown, userId: string): Record<string, unknown> {
  const base = (where ?? {}) as Record<string, unknown>;
  // AND-merge rather than spread: never let a caller-supplied `userId` (or an
  // OR branch) widen the filter beyond the authenticated tenant.
  return { AND: [base, { userId }] };
}

function scopeUniqueWhere(where: unknown, userId: string): Record<string, unknown> {
  // Sibling-merge: the unique selector stays at the top level (required by
  // Prisma) and the tenant `userId` is ANDed alongside it. Spread first so the
  // tenant's userId always wins over a caller-supplied one; a mismatched
  // userId inside a compound selector simply matches no row (P2025/not found).
  return { ...(where as Record<string, unknown>), userId };
}

function stampData(data: unknown, userId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => ({ ...d, userId }));
  return { ...(data as Record<string, unknown>), userId };
}

function createTenantClient(userId: string) {
  if (!userId) throw new Error('tenantDb requires a non-empty userId');

  return prisma.$extends({
    name: `tenant:${userId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);

          const a = { ...(args as Record<string, unknown>) };

          if (WHERE_OPS.has(operation)) {
            a.where = scopeWhere(a.where, userId);
          } else if (UNIQUE_WHERE_OPS.has(operation)) {
            a.where = scopeUniqueWhere(a.where, userId) as never;
          }

          if (CREATE_OPS.has(operation)) {
            a.data = stampData(a.data, userId);
          }

          if (operation === 'upsert') {
            a.create = stampData(a.create, userId);
            // `update` of an upsert only runs when the scoped `where` matched,
            // so the row is already owned; still stamp for belt-and-braces.
            a.update = { ...(a.update as Record<string, unknown>), userId };
          }

          if (operation === 'update' || operation === 'updateMany') {
            // Prevent a payload from re-homing a row onto another tenant.
            const data = a.data as Record<string, unknown> | undefined;
            if (data && ('userId' in data || 'user' in data)) {
              delete data.userId;
              delete data.user;
            }
          }

          return query(a as never);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;

// One extended client per tenant, cached: $extends is cheap but not free, and
// hot tenants issue many requests. Bounded to avoid unbounded growth.
const CACHE_MAX = 500;
const cache = new Map<string, TenantClient>();

export function tenantDb(userId: string): TenantClient {
  const hit = cache.get(userId);
  if (hit) return hit;

  const client = createTenantClient(userId);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, client);
  return client;
}

// Re-exported so callers can type Prisma errors without importing @prisma/client.
export { Prisma };
