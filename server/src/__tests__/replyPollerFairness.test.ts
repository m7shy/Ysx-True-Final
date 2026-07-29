// FILE: server/src/__tests__/replyPollerFairness.test.ts
//
// Tests for per-tenant (and per-lead) fairness in the Unibox reply poller's
// lead selection.
//
// The regression being guarded is starvation, and it was permanent rather than
// slow: selection ordered by `lastContacted asc` with a flat global `take`, and
// `lastContacted` is not modified by a scan that finds no reply. So whatever
// the first tick selected, every later tick selected again — identically —
// and any lead outside that window was never scanned at all.
//
// Two independent cases, both of which the old code failed:
//   1. one tenant with more contacted leads than the budget starves the others;
//   2. a single tenant with more contacted leads than the budget starves its
//      own tail.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadStatus } from '@prisma/client';

const { db } = vi.hoisted(() => ({
  db: { leads: [] as any[] },
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    lead: {
      groupBy: async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const lead of db.leads) {
          if (where?.status && lead.status !== where.status) continue;
          counts.set(lead.userId, (counts.get(lead.userId) ?? 0) + 1);
        }
        return [...counts.entries()].map(([userId, n]) => ({ userId, _count: { _all: n } }));
      },
      findMany: async ({ where, orderBy, skip, take }: any) => {
        let rows = db.leads.filter((lead) => {
          if (where?.status && lead.status !== where.status) return false;
          if (where?.userId && lead.userId !== where.userId) return false;
          return true;
        });
        // The query orders by [lastContacted asc, id asc]; the id tiebreak is
        // there because Postgres does not promise a stable order for equal
        // keys. This fake sorts deterministically no matter what, so it cannot
        // demonstrate the instability — mirroring the clause here keeps the
        // fake honest about the query shape rather than pretending to prove it.
        const terms = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (terms.some((t: any) => t?.lastContacted === 'asc')) {
          const byId = terms.some((t: any) => t?.id === 'asc');
          rows = [...rows].sort((a, b) => {
            const d = new Date(a.lastContacted).getTime() - new Date(b.lastContacted).getTime();
            if (d !== 0 || !byId) return d;
            return String(a.id).localeCompare(String(b.id));
          });
        }
        if (skip) rows = rows.slice(skip);
        if (take != null) rows = rows.slice(0, take);
        return rows;
      },
      update: async () => ({}),
    },
    mailbox: {
      // No tenant has a connected mailbox in these tests: selection is what is
      // under test, and an empty mailbox list makes the tick a pure no-op after
      // selection. `scanMailbox` is never reached, so no IMAP mocking is needed.
      findMany: async () => [],
    },
  },
}));

vi.mock('../scheduler/pulse.js', () => ({
  mayPoll: () => true,
  reportWork: () => {},
}));

// SCAN_LIMIT is resolved from the environment once, at module scope, so this
// MUST be set before the import below — setting it in beforeEach() leaves the
// budget at its 100 default, which is larger than any fixture here and makes
// every assertion pass regardless of whether the fix is present.
process.env.UNIBOX_SCAN_LIMIT = '10';

// Imported after the mocks are registered and the budget is set.
const { replyPollTickOnce, __resetScanRotationForTests } = await import('../unibox/replyPoller.js');

/**
 * Capture which leads a tick selected. `prisma.mailbox.findMany` is called once
 * per tenant that made it into the selection, so spying on the grouping is the
 * cleanest observation point that does not require reaching IMAP.
 */
async function tenantsScannedIn(tick: () => Promise<void>): Promise<string[]> {
  const { prisma } = await import('../db/prisma.js');
  const seen: string[] = [];
  const original = prisma.mailbox.findMany;
  (prisma.mailbox as any).findMany = async (args: any) => {
    seen.push(args.where.userId);
    return original(args);
  };
  try {
    await tick();
  } finally {
    (prisma.mailbox as any).findMany = original;
  }
  return seen;
}

function seedLeads(userId: string, count: number, baseDayOffset: number): void {
  for (let i = 0; i < count; i++) {
    db.leads.push({
      id: `${userId}-lead-${i}`,
      userId,
      email: `${userId}-${i}@example.com`,
      status: LeadStatus.CONTACTED,
      // Older base offset => older lastContacted => selected first by the
      // pre-fix ordering.
      lastContacted: new Date(Date.UTC(2026, 0, baseDayOffset, 0, i)),
      intelligence: null,
    });
  }
}

beforeEach(() => {
  db.leads = [];
  __resetScanRotationForTests();
});

describe('reply poller — cross-tenant fairness', () => {
  it('scans a quiet tenant even when a busy tenant has older leads than the whole budget', async () => {
    // Tenant A: 50 contacted leads, ALL older than tenant B's. Under the old
    // global `orderBy lastContacted asc, take: SCAN_LIMIT`, tenant A fills the
    // entire budget and tenant B is never reached — on this tick or any other.
    seedLeads('tenant-a', 50, 1);
    seedLeads('tenant-b', 3, 20);

    const scanned = await tenantsScannedIn(replyPollTickOnce);

    expect(scanned).toContain('tenant-b');
    expect(scanned).toContain('tenant-a');
  });

  it('gives every tenant a share of the budget rather than all of it to one', async () => {
    seedLeads('tenant-a', 50, 1);
    seedLeads('tenant-b', 50, 20);

    const { prisma } = await import('../db/prisma.js');
    const takenPerTenant = new Map<string, number>();
    const original = prisma.lead.findMany;
    (prisma.lead as any).findMany = async (args: any) => {
      const rows = await original(args);
      if (args.where?.userId) {
        takenPerTenant.set(args.where.userId, (takenPerTenant.get(args.where.userId) ?? 0) + rows.length);
      }
      return rows;
    };
    try {
      await replyPollTickOnce();
    } finally {
      (prisma.lead as any).findMany = original;
    }

    // Budget 10 across 2 tenants: 5 each. The point is that neither is zero.
    expect(takenPerTenant.get('tenant-a')).toBe(5);
    expect(takenPerTenant.get('tenant-b')).toBe(5);
  });
});

describe('reply poller — more tenants than the budget can serve', () => {
  it('rotates the starting tenant so every tenant is eventually scanned', async () => {
    // The regression this guards: `tenantRotation` could be deleted outright and
    // all the other fairness tests still passed, because none of them creates
    // more tenants than SCAN_LIMIT. That is exactly when rotation is the only
    // thing standing between "waits a tick" and "never scanned at all" — with a
    // fixed start, the tenants past the budget are starved permanently.
    //
    // 25 tenants, budget 10: at one lead each, a single tick can only reach 10.
    for (let i = 0; i < 25; i++) {
      seedLeads(`tenant-${String(i).padStart(2, '0')}`, 1, 1);
    }

    const { prisma } = await import('../db/prisma.js');
    const scanned = new Set<string>();
    const original = prisma.lead.findMany;
    (prisma.lead as any).findMany = async (args: any) => {
      const rows = await original(args);
      if (args.where?.userId && rows.length > 0) scanned.add(args.where.userId);
      return rows;
    };
    try {
      // Three ticks serve at most 30 tenant-slots; with rotation that covers all
      // 25. Without it, the same 10 are re-scanned every tick, forever.
      await replyPollTickOnce();
      await replyPollTickOnce();
      await replyPollTickOnce();
    } finally {
      (prisma.lead as any).findMany = original;
    }

    expect(scanned.size).toBe(25);
  });
});

describe('reply poller — intra-tenant fairness', () => {
  it('advances through a single tenant\'s queue instead of rescanning the same oldest leads', async () => {
    // One tenant, 25 contacted leads, budget 10. Ticks 1-3 must between them
    // reach every lead. The old code returned leads 0-9 on all three ticks and
    // never touched 10-24, because nothing it did changed `lastContacted`.
    seedLeads('solo', 25, 1);

    const { prisma } = await import('../db/prisma.js');
    const selected = new Set<string>();
    const original = prisma.lead.findMany;
    (prisma.lead as any).findMany = async (args: any) => {
      const rows = await original(args);
      if (args.where?.userId) rows.forEach((r: any) => selected.add(r.id));
      return rows;
    };
    try {
      await replyPollTickOnce();
      await replyPollTickOnce();
      await replyPollTickOnce();
    } finally {
      (prisma.lead as any).findMany = original;
    }

    expect(selected.size).toBe(25);
  });

  it('wraps the cursor back to the front of the queue rather than returning a short page', async () => {
    // 12 leads, budget 10: tick 1 takes 0-9, tick 2 starts at cursor 10 and
    // must top up with 2 more from the front to use its full share.
    seedLeads('solo', 12, 1);

    const { prisma } = await import('../db/prisma.js');
    let lastTickCount = 0;
    const original = prisma.lead.findMany;
    (prisma.lead as any).findMany = async (args: any) => {
      const rows = await original(args);
      if (args.where?.userId) lastTickCount += rows.length;
      return rows;
    };
    try {
      await replyPollTickOnce();
      lastTickCount = 0;
      await replyPollTickOnce();
    } finally {
      (prisma.lead as any).findMany = original;
    }

    expect(lastTickCount).toBe(10);
  });
});
