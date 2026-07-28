// FILE: server/src/__tests__/revisionRound.test.ts
//
// Tests for revision round allocation under concurrency.
//
// The defect: the next round was derived as "read the current max, add one",
// with no constraint and no transaction. Two submissions on one project — a
// double-click, or two people on the same client team — both read round N and
// both insert N+1, producing two rows the client sees as the same round.
//
// The fix is @@unique([projectId, roundNumber]) plus a bounded retry, so the
// loser of the race re-reads and takes the next number instead of silently
// duplicating. The prisma mock below therefore ENFORCES that constraint — a
// mock that accepts duplicates would let the old code pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, hooks } = vi.hoisted(() => ({
  db: { revisions: [] as any[], seq: 0 },
  hooks: { beforeCreate: null as null | (() => Promise<void>) },
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    revision: {
      findFirst: async ({ where, orderBy }: any) => {
        // An absent projectId means "no filter", matching Prisma. Treating it as
        // `r.projectId === undefined` instead would silently return nothing, and
        // a test for per-project scoping would then pass even against code that
        // dropped the scope entirely.
        let rows = db.revisions.filter(
          (r) => where?.projectId === undefined || r.projectId === where.projectId,
        );
        if (orderBy?.roundNumber === 'desc') {
          rows = [...rows].sort((a, b) => b.roundNumber - a.roundNumber);
        }
        // Yield the event loop so two concurrent callers genuinely interleave
        // their reads — without this the race cannot be reproduced in-process.
        await new Promise((resolve) => setImmediate(resolve));
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        if (hooks.beforeCreate) await hooks.beforeCreate();

        // The real constraint, enforced. P2002 with the shape Prisma emits.
        const clash = db.revisions.some(
          (r) => r.projectId === data.projectId && r.roundNumber === data.roundNumber,
        );
        if (clash) {
          const err: any = new Error(
            'Unique constraint failed on the fields: (`projectId`,`roundNumber`)',
          );
          err.code = 'P2002';
          err.meta = { target: ['projectId', 'roundNumber'] };
          throw err;
        }

        const row = { id: `rev-${++db.seq}`, createdAt: new Date(), ...data };
        db.revisions.push(row);
        return row;
      },
    },
  },
}));

vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { createNextRevision } = await import('../portal/routes.js');

beforeEach(() => {
  db.revisions = [];
  db.seq = 0;
  hooks.beforeCreate = null;
});

describe('revision round allocation', () => {
  it('numbers rounds sequentially when submissions are serial', async () => {
    const a = await createNextRevision('proj-1', 'first');
    const b = await createNextRevision('proj-1', 'second');

    expect(a?.roundNumber).toBe(1);
    expect(b?.roundNumber).toBe(2);
  });

  it('numbers rounds independently per project', async () => {
    await createNextRevision('proj-1', 'first');
    const other = await createNextRevision('proj-2', 'first');

    expect(other?.roundNumber).toBe(1);
  });

  it('gives two concurrent submissions distinct rounds instead of duplicating one', async () => {
    // Both calls read the max before either writes — the exact interleaving
    // that produced two "Round 1" rows before the constraint existed.
    const [a, b] = await Promise.all([
      createNextRevision('proj-1', 'double'),
      createNextRevision('proj-1', 'click'),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(new Set([a!.roundNumber, b!.roundNumber]).size).toBe(2);
    expect([a!.roundNumber, b!.roundNumber].sort()).toEqual([1, 2]);
    expect(db.revisions).toHaveLength(2);
  });

  it('resolves a burst of concurrent submissions into a gap-free sequence', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createNextRevision('proj-1', `note-${i}`)),
    );

    const rounds = results.map((r) => r!.roundNumber).sort((x, y) => x - y);
    expect(rounds).toEqual([1, 2, 3, 4]);
  });

  it('returns null rather than throwing when collisions exhaust the retry budget', async () => {
    // A create that always collides: stands in for sustained contention, and
    // pins that the route degrades to a 409 instead of a 500.
    hooks.beforeCreate = async () => {
      const err: any = new Error('Unique constraint failed on the fields: (`roundNumber`)');
      err.code = 'P2002';
      err.meta = { target: ['projectId', 'roundNumber'] };
      throw err;
    };

    await expect(createNextRevision('proj-1', 'doomed')).resolves.toBeNull();
  });

  it('propagates non-collision database errors instead of swallowing them', async () => {
    hooks.beforeCreate = async () => {
      throw new Error('connection terminated');
    };

    await expect(createNextRevision('proj-1', 'boom')).rejects.toThrow('connection terminated');
  });
});
