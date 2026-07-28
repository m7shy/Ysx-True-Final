// FILE: server/src/__tests__/workerFairness.test.ts
//
// Tests for interleaveByTenant(), the campaign worker's per-tick ordering.
//
// Scope note, because the handoff overstated this: the worker has never had a
// global budget that one tenant could drain — every ACTIVE campaign is visited
// on every tick, and mailbox selection, the tier cap and the daily budget are
// all per tenant. What the old flat `createdAt asc` ordering did cost is
// position: the same tenants sat behind every older tenant's SMTP round-trips
// on every tick. These tests pin the ordering property only.

import { describe, it, expect, beforeEach } from 'vitest';
import { interleaveByTenant, __resetTenantRotationForTests } from '../campaigns/worker.js';

const c = (id: string, userId: string) => ({ id, userId });

beforeEach(() => {
  __resetTenantRotationForTests();
});

describe('interleaveByTenant', () => {
  it('round-robins across tenants instead of draining one tenant first', () => {
    // Arrives in createdAt order: tenant-a created all three of its campaigns
    // before tenant-b created any. Flat ordering runs a1,a2,a3 before b1 —
    // tenant-b's only campaign waits behind three of tenant-a's every tick.
    const input = [c('a1', 'a'), c('a2', 'a'), c('a3', 'a'), c('b1', 'b')];

    const out = interleaveByTenant(input).map((x) => x.id);

    // b1 must not be last; one campaign from each tenant comes first.
    expect(out.slice(0, 2).sort()).toEqual(['a1', 'b1']);
    expect(out).toHaveLength(4);
    expect([...out].sort()).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('rotates which tenant is served first across consecutive ticks', () => {
    const input = [c('a1', 'a'), c('b1', 'b'), c('c1', 'c')];

    const first = interleaveByTenant(input)[0].userId;
    const second = interleaveByTenant(input)[0].userId;
    const third = interleaveByTenant(input)[0].userId;

    // Three tenants, three ticks: each should lead exactly once.
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('preserves every campaign exactly once when tenants have uneven counts', () => {
    const input = [
      c('a1', 'a'), c('a2', 'a'), c('a3', 'a'), c('a4', 'a'),
      c('b1', 'b'),
      c('d1', 'd'), c('d2', 'd'),
    ];

    const out = interleaveByTenant(input);

    expect(out).toHaveLength(input.length);
    expect([...out].map((x) => x.id).sort()).toEqual(
      ['a1', 'a2', 'a3', 'a4', 'b1', 'd1', 'd2'].sort(),
    );
  });

  it('keeps each tenant\'s own campaigns in createdAt order', () => {
    const input = [c('a1', 'a'), c('a2', 'a'), c('b1', 'b'), c('a3', 'a')];

    const out = interleaveByTenant(input).filter((x) => x.userId === 'a').map((x) => x.id);

    expect(out).toEqual(['a1', 'a2', 'a3']);
  });
});

// Deliberately NOT tested: "is a no-op for a single tenant". The single-tenant
// path is an early return, so that assertion holds under every mutation of the
// interleave — including gutting it to `return campaigns` and to a lossy
// one-per-tenant version. It cannot fail, so it is not a test.
