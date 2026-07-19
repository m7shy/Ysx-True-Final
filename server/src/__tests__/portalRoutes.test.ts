import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

/**
 * Integration tests for the portal-facing and admin portal-management routes,
 * against a small generic in-memory Prisma stand-in. Focus: tenant/client
 * scoping (IDOR), revision round-numbering, invoice lifecycle, activity writes.
 */

type Row = Record<string, any>;

const { db, prismaMock, sentEmails } = vi.hoisted(() => {
const db: Record<string, Row[]> = {
  user: [
    { id: 'ownerA', email: 'a@agency.com', tokenVersion: 0, status: 'ACTIVE', tier: 'PRO' },
    { id: 'ownerB', email: 'b@agency.com', tokenVersion: 0, status: 'ACTIVE', tier: 'PRO' },
  ],
  mailbox: [{ id: 'mb1', userId: 'ownerA', email: 'a@agency.com', isActive: true, createdAt: new Date() }],
  client: [
    { id: 'cA', userId: 'ownerA', name: 'Client A', companyName: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'cB', userId: 'ownerB', name: 'Client B', companyName: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ],
  clientUser: [
    { id: 'cuA', clientId: 'cA', userId: 'ownerA', email: 'clienta@x.com', passwordHash: null, tokenVersion: 0, lastLoginAt: null },
    { id: 'cuB', clientId: 'cB', userId: 'ownerB', email: 'clientb@x.com', passwordHash: null, tokenVersion: 0, lastLoginAt: null },
  ],
  clientLoginToken: [],
  project: [
    { id: 'pA', userId: 'ownerA', clientId: 'cA', name: 'Video A', status: 'ACTIVE', stage: 'EDITING', progressPct: 40, etaAt: null, nextStepNote: null, waitingOnClient: false, waitingOnClientNote: null, scopeSummary: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date() },
    { id: 'pB', userId: 'ownerB', clientId: 'cB', name: 'Video B', status: 'ACTIVE', stage: 'EDITING', progressPct: 10, etaAt: null, nextStepNote: null, waitingOnClient: false, waitingOnClientNote: null, scopeSummary: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date() },
  ],
  fileLink: [],
  revision: [],
  message: [],
  activityEvent: [],
  invoice: [],
  payment: [],
  receipt: [],
};

let seq = 1;
const nextId = (m: string) => `${m}${seq++}`;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return row[k] !== v.not;
      if ('gt' in v) return row[k] > v.gt;
      if ('equals' in v) return String(row[k]).toLowerCase() === String(v.equals).toLowerCase();
      // Nested relation filter — not supported; treat as pass (test data is single-tenant per case).
      return true;
    }
    return row[k] === v;
  });
}

function orderRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [k, dir] = Object.entries(spec)[0] as [string, string];
      if (a[k] === b[k]) continue;
      const cmp = a[k] > b[k] ? 1 : -1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

const RELATIONS: Record<string, Record<string, { model: string; fk: string; many: boolean; localFk?: string }>> = {
  client: {
    clientUsers: { model: 'clientUser', fk: 'clientId', many: true },
    projects: { model: 'project', fk: 'clientId', many: true },
    invoices: { model: 'invoice', fk: 'clientId', many: true },
  },
  project: {
    client: { model: 'client', fk: 'id', many: false, localFk: 'clientId' },
    fileLinks: { model: 'fileLink', fk: 'projectId', many: true },
    revisions: { model: 'revision', fk: 'projectId', many: true },
    messages: { model: 'message', fk: 'projectId', many: true },
    activities: { model: 'activityEvent', fk: 'projectId', many: true },
    invoices: { model: 'invoice', fk: 'projectId', many: true },
  },
  invoice: {
    client: { model: 'client', fk: 'id', many: false, localFk: 'clientId' },
    project: { model: 'project', fk: 'id', many: false, localFk: 'projectId' },
    payments: { model: 'payment', fk: 'invoiceId', many: true },
  },
  payment: {
    receipt: { model: 'receipt', fk: 'paymentId', many: false },
    invoice: { model: 'invoice', fk: 'id', many: false, localFk: 'invoiceId' },
  },
  clientLoginToken: {
    clientUser: { model: 'clientUser', fk: 'id', many: false, localFk: 'clientUserId' },
  },
  clientUser: {
    client: { model: 'client', fk: 'id', many: false, localFk: 'clientId' },
  },
};

function expand(model: string, row: Row, include: any): Row {
  if (!include || !row) return row;
  const out = { ...row };
  const counts: Row = {};
  for (const [key, incl] of Object.entries(include)) {
    if (key === '_count') {
      const sel = (incl as any).select ?? {};
      for (const rel of Object.keys(sel)) {
        const def = RELATIONS[model]?.[rel];
        counts[rel] = def ? db[def.model].filter((r) => r[def.fk] === row.id).length : 0;
      }
      out._count = counts;
      continue;
    }
    const def = RELATIONS[model]?.[key];
    if (!def) continue;
    const opts = typeof incl === 'object' && incl !== null ? (incl as any) : {};
    if (def.many) {
      let rel = db[def.model].filter((r) => r[def.fk] === row.id && matches(r, opts.where));
      rel = orderRows(rel, opts.orderBy);
      if (opts.take) rel = rel.slice(0, opts.take);
      out[key] = rel.map((r) => expand(def.model, r, opts.include));
    } else {
      const target = def.localFk
        ? db[def.model].find((r) => r.id === row[def.localFk!])
        : db[def.model].find((r) => r[def.fk] === row.id);
      out[key] = target ? expand(def.model, { ...target }, opts.include) : null;
    }
  }
  return out;
}

function makeModel(model: string) {
  return {
    findMany: async (args: any = {}) => {
      let rows = db[model].filter((r) => matches(r, args.where));
      rows = orderRows(rows, args.orderBy);
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => expand(model, { ...r }, args.include));
    },
    findFirst: async (args: any = {}) => {
      const rows = orderRows(db[model].filter((r) => matches(r, args.where)), args.orderBy);
      return rows[0] ? expand(model, { ...rows[0] }, args.include) : null;
    },
    findUnique: async (args: any = {}) => {
      const row = db[model].find((r) => matches(r, args.where));
      return row ? expand(model, { ...row }, args.include) : null;
    },
    count: async (args: any = {}) => db[model].filter((r) => matches(r, args.where)).length,
    create: async (args: any) => {
      const { receipt, ...data } = args.data;
      const defaults: Row =
        model === 'invoice'
          ? { status: 'DRAFT', currency: 'usd' }
          : model === 'revision'
            ? { status: 'OPEN' }
            : model === 'fileLink'
              ? { version: 1, type: 'FILE_LINK' }
              : model === 'clientLoginToken'
                ? { usedAt: null }
                : {};
      const row: Row = { id: nextId(model), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      db[model].push(row);
      if (model === 'payment' && receipt?.create) {
        db.receipt.push({ id: nextId('receipt'), paymentId: row.id, createdAt: new Date(), ...receipt.create });
      }
      return expand(model, { ...row }, args.include);
    },
    update: async (args: any) => {
      const row = db[model].find((r) => matches(r, args.where));
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      Object.assign(row, args.data, { updatedAt: new Date() });
      return expand(model, { ...row }, args.include);
    },
    updateMany: async (args: any) => {
      const rows = db[model].filter((r) => matches(r, args.where));
      rows.forEach((r) => Object.assign(r, args.data));
      return { count: rows.length };
    },
    deleteMany: async (args: any) => {
      const before = db[model].length;
      db[model] = db[model].filter((r) => !matches(r, args.where));
      return { count: before - db[model].length };
    },
  };
}

const prismaMock: Row = { $extends: undefined };
for (const m of Object.keys(db)) prismaMock[m] = makeModel(m);
// tenantDb calls prisma.$extends — return a proxy that injects userId scoping
// by wrapping each model's args (good-enough stand-in for the real extension).
prismaMock.$extends = (ext: any) => {
  const userId = String(ext.name).split(':')[1];
  const scoped: Row = {};
  for (const m of Object.keys(db)) {
    const tenantScoped = ['client', 'project', 'invoice', 'lead', 'campaign', 'mailbox'].includes(m);
    scoped[m] = new Proxy(prismaMock[m], {
      get(target, op: string) {
        if (!tenantScoped) return target[op];
        return (args: any = {}) => {
          const a = { ...args };
          if (op === 'create') a.data = { ...a.data, userId };
          else a.where = { ...(a.where ?? {}), userId };
          return target[op](a);
        };
      },
    });
  }
  return scoped;
};

const sentEmails: any[] = [];

return { db, prismaMock, sentEmails };
});

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../mail/smtpGateway.js', async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    sendFromMailbox: async (_mb: any, input: any) => {
      sentEmails.push(input);
      return 'msg-1';
    },
  };
});

import { app } from '../index.js';
import { signAccessToken } from '../auth/jwt.js';
import { signClientAccessToken } from '../auth/clientJwt.js';

const adminA = `Bearer ${signAccessToken({ userId: 'ownerA', email: 'a@agency.com' })}`;
const adminB = `Bearer ${signAccessToken({ userId: 'ownerB', email: 'b@agency.com' })}`;
const clientA = `Bearer ${signClientAccessToken({ clientUserId: 'cuA', clientId: 'cA', userId: 'ownerA', email: 'clienta@x.com', tokenVersion: 0 })}`;
const clientB = `Bearer ${signClientAccessToken({ clientUserId: 'cuB', clientId: 'cB', userId: 'ownerB', email: 'clientb@x.com', tokenVersion: 0 })}`;

describe('admin tenant isolation', () => {
  it('tenant B cannot read or patch tenant A projects/clients', async () => {
    const listB = await request(app).get('/api/projects').set('Authorization', adminB);
    expect(listB.status).toBe(200);
    expect(listB.body.projects.map((p: any) => p.id)).toEqual(['pB']);

    const patch = await request(app)
      .patch('/api/projects/pA')
      .set('Authorization', adminB)
      .send({ stage: 'COMPLETE' });
    expect(patch.status).toBe(404);

    const invite = await request(app)
      .post('/api/clients/cA/invite')
      .set('Authorization', adminB)
      .send({ email: 'x@y.com' });
    expect(invite.status).toBe(404);
  });

  it('stage change writes an activity event', async () => {
    const patch = await request(app)
      .patch('/api/projects/pA')
      .set('Authorization', adminA)
      .send({ stage: 'REVISION', waitingOnClient: true, waitingOnClientNote: 'Send brand fonts' });
    expect(patch.status).toBe(200);
    const acts = db.activityEvent.filter((a) => a.projectId === 'pA');
    expect(acts.some((a) => a.type === 'STAGE_CHANGED')).toBe(true);
    expect(acts.some((a) => a.type === 'WAITING_ON_CLIENT' && a.summary.includes('brand fonts'))).toBe(true);
  });

  it('file links auto-version per label', async () => {
    const f1 = await request(app)
      .post('/api/projects/pA/files')
      .set('Authorization', adminA)
      .send({ type: 'DELIVERABLE', label: 'Final Cut', url: 'https://drive.example.com/v1' });
    expect(f1.status).toBe(201);
    expect(f1.body.file.version).toBe(1);

    const f2 = await request(app)
      .post('/api/projects/pA/files')
      .set('Authorization', adminA)
      .send({ type: 'DELIVERABLE', label: 'Final Cut', url: 'https://drive.example.com/v2' });
    expect(f2.body.file.version).toBe(2);
  });
});

describe('portal client scoping (IDOR)', () => {
  it('client B cannot see client A project by crafted id', async () => {
    const own = await request(app).get('/api/portal/projects/pA').set('Authorization', clientA);
    expect(own.status).toBe(200);
    expect(own.body.project.name).toBe('Video A');

    const foreign = await request(app).get('/api/portal/projects/pA').set('Authorization', clientB);
    expect(foreign.status).toBe(404);

    const foreignRevision = await request(app)
      .post('/api/portal/projects/pA/revisions')
      .set('Authorization', clientB)
      .send({ note: 'sneaky' });
    expect(foreignRevision.status).toBe(404);
  });

  it('CRM admin token is rejected on portal routes', async () => {
    const res = await request(app).get('/api/portal/projects').set('Authorization', adminA);
    expect(res.status).toBe(401);
  });

  it('revision rounds number sequentially and approve requires SUBMITTED', async () => {
    const r1 = await request(app)
      .post('/api/portal/projects/pA/revisions')
      .set('Authorization', clientA)
      .send({ note: 'Tighter intro please' });
    expect(r1.status).toBe(201);
    expect(r1.body.revision.roundNumber).toBe(1);

    const r2 = await request(app)
      .post('/api/portal/projects/pA/revisions')
      .set('Authorization', clientA)
      .send({ note: 'Color grade v2' });
    expect(r2.body.revision.roundNumber).toBe(2);

    // Approving an OPEN revision is a 409; after admin marks SUBMITTED it works.
    const early = await request(app)
      .post(`/api/portal/projects/pA/revisions/${r1.body.revision.id}/approve`)
      .set('Authorization', clientA);
    expect(early.status).toBe(409);

    await request(app)
      .patch(`/api/projects/pA/revisions/${r1.body.revision.id}`)
      .set('Authorization', adminA)
      .send({ status: 'SUBMITTED', respondedNote: 'New cut uploaded' });

    const approve = await request(app)
      .post(`/api/portal/projects/pA/revisions/${r1.body.revision.id}/approve`)
      .set('Authorization', clientA);
    expect(approve.status).toBe(200);
    expect(approve.body.revision.status).toBe('APPROVED');
  });
});

describe('invoice lifecycle', () => {
  let invoiceId: string;

  it('create → send (emails client, activity) → client views → mark paid (payment+receipt)', async () => {
    const created = await request(app)
      .post('/api/invoices')
      .set('Authorization', adminA)
      .send({ clientId: 'cA', projectId: 'pA', amountCents: 250000, dueAt: '2026-08-01' });
    expect(created.status).toBe(201);
    expect(created.body.invoice.number).toBe('INV-0001');
    expect(created.body.invoice.status).toBe('DRAFT');
    invoiceId = created.body.invoice.id;

    // Hidden from the client while DRAFT.
    const hidden = await request(app).get('/api/portal/invoices').set('Authorization', clientA);
    expect(hidden.body.invoices).toHaveLength(0);

    const sent = await request(app).post(`/api/invoices/${invoiceId}/send`).set('Authorization', adminA);
    expect(sent.status).toBe(200);
    expect(sent.body.invoice.status).toBe('SENT');
    expect(sentEmails.some((e) => e.subject.includes('INV-0001'))).toBe(true);

    // Client list shows it with outstanding balance; detail flips to VIEWED.
    const list = await request(app).get('/api/portal/invoices').set('Authorization', clientA);
    expect(list.body.outstandingCents).toBe(250000);

    const detail = await request(app).get(`/api/portal/invoices/${invoiceId}`).set('Authorization', clientA);
    expect(detail.status).toBe(200);
    expect(detail.body.invoice.status).toBe('VIEWED');
    expect(detail.body.paymentInstructions.method).toBe('BANK_TRANSFER');

    // Foreign client can't see it.
    const foreign = await request(app).get(`/api/portal/invoices/${invoiceId}`).set('Authorization', clientB);
    expect(foreign.status).toBe(404);

    const paid = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', adminA)
      .send({ reference: 'WIRE-123' });
    expect(paid.status).toBe(200);
    expect(paid.body.invoice.status).toBe('PAID');
    expect(paid.body.payment.receipt.number).toBe('RCPT-0001');

    // Double mark-paid rejected; paid invoice not editable.
    const again = await request(app).post(`/api/invoices/${invoiceId}/mark-paid`).set('Authorization', adminA);
    expect(again.status).toBe(409);
    const edit = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set('Authorization', adminA)
      .send({ amountCents: 1 });
    expect(edit.status).toBe(409);

    const acts = db.activityEvent.filter((a) => a.projectId === 'pA').map((a) => a.type);
    expect(acts).toContain('INVOICE_SENT');
    expect(acts).toContain('INVOICE_PAID');
  });
});

describe('cross-audience token rejection (client token on CRM routes)', () => {
  it('a portal client token is rejected by CRM-side auth', async () => {
    for (const path of ['/api/clients', '/api/projects', '/api/invoices']) {
      const res = await request(app).get(path).set('Authorization', clientA);
      expect(res.status).toBe(401);
    }
  });

  it('a portal client token cannot mutate CRM data', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', clientA)
      .send({ name: 'Sneaky Client' });
    expect(res.status).toBe(401);
    expect(db.client.some((c) => c.name === 'Sneaky Client')).toBe(false);
  });
});

describe('invite → set-password → password login flow', () => {
  let inviteToken: string;

  it('admin invites a new email; invite email carries a set-password link', async () => {
    const res = await request(app)
      .post('/api/clients/cA/invite')
      .set('Authorization', adminA)
      .send({ email: 'newuser@x.com' });
    expect(res.status).toBe(201);
    const mail = sentEmails.at(-1);
    expect(mail.to).toBe('newuser@x.com');
    inviteToken = mail.text.match(/set-password\?token=([A-Za-z0-9_-]+)/)![1];
  });

  it('an INVITE token cannot be consumed as a magic link (kind separation)', async () => {
    const res = await request(app)
      .post('/api/portal/auth/magic-link/consume')
      .send({ token: inviteToken });
    expect(res.status).toBe(401);
  });

  it('set-password consumes the invite, logs in, and the token is single-use', async () => {
    const set = await request(app)
      .post('/api/portal/auth/set-password')
      .send({ token: inviteToken, password: 'brand-new-pass-1' });
    expect(set.status).toBe(201);
    expect(set.body.accessToken).toBeTruthy();
    expect(set.body.client.name).toBe('Client A');

    const replay = await request(app)
      .post('/api/portal/auth/set-password')
      .send({ token: inviteToken, password: 'other-pass-123' });
    expect(replay.status).toBe(401);

    const login = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: 'newuser@x.com', password: 'brand-new-pass-1' });
    expect(login.status).toBe(200);

    const bad = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: 'newuser@x.com', password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('rejects a short password on set-password', async () => {
    const res = await request(app)
      .post('/api/portal/auth/set-password')
      .send({ token: 'whatever', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('re-homing an email attached to another client is a 409 EMAIL_TAKEN', async () => {
    const res = await request(app)
      .post('/api/clients/cA/invite')
      .set('Authorization', adminA)
      .send({ email: 'clientb@x.com' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('invite fails loud with NO_MAILBOX when the tenant has no active mailbox', async () => {
    const res = await request(app)
      .post('/api/clients/cB/invite')
      .set('Authorization', adminB)
      .send({ email: 'freshclient@x.com' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_MAILBOX');
  });
});

describe('input validation + ownership edges', () => {
  it('empty revision note and empty message are 400s', async () => {
    const rev = await request(app)
      .post('/api/portal/projects/pA/revisions')
      .set('Authorization', clientA)
      .send({ note: '   ' });
    expect(rev.status).toBe(400);

    const msg = await request(app)
      .post('/api/portal/projects/pA/messages')
      .set('Authorization', clientA)
      .send({ body: '' });
    expect(msg.status).toBe(400);
  });

  it('invoice creation rejects non-positive amounts and foreign projects', async () => {
    const zero = await request(app)
      .post('/api/invoices')
      .set('Authorization', adminA)
      .send({ clientId: 'cA', amountCents: 0 });
    expect(zero.status).toBe(400);

    // pB belongs to tenant B / client B — cannot be attached to an A invoice.
    const foreign = await request(app)
      .post('/api/invoices')
      .set('Authorization', adminA)
      .send({ clientId: 'cA', projectId: 'pB', amountCents: 1000 });
    expect(foreign.status).toBe(404);
  });

  it('file link URL must be a valid URL; foreign admin cannot delete files', async () => {
    const bad = await request(app)
      .post('/api/projects/pA/files')
      .set('Authorization', adminA)
      .send({ label: 'Notes', url: 'not-a-url' });
    expect(bad.status).toBe(400);

    const file = db.fileLink.find((f) => f.projectId === 'pA');
    expect(file).toBeTruthy();
    const del = await request(app)
      .delete(`/api/projects/pA/files/${file!.id}`)
      .set('Authorization', adminB);
    expect(del.status).toBe(404);
    expect(db.fileLink.some((f) => f.id === file!.id)).toBe(true);
  });
});

describe('messages', () => {
  it('client and admin messages carry the right author label and write activity', async () => {
    const c = await request(app)
      .post('/api/portal/projects/pA/messages')
      .set('Authorization', clientA)
      .send({ body: 'Looks great so far!' });
    expect(c.status).toBe(201);
    expect(c.body.message.authorType).toBe('CLIENT');
    expect(c.body.message.authorLabel).toBe('Client A');

    const a = await request(app)
      .post('/api/projects/pA/messages')
      .set('Authorization', adminA)
      .send({ body: 'Thanks — new cut tomorrow.' });
    expect(a.status).toBe(201);
    expect(a.body.message.authorType).toBe('ADMIN');
    expect(a.body.message.authorLabel).toBe('YSX Visuals');

    const acts = db.activityEvent.filter((x) => x.projectId === 'pA' && x.type === 'MESSAGE_POSTED');
    expect(acts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('portal dashboard + requests', () => {
  it('dashboard lists own active projects with trust signals', async () => {
    const res = await request(app).get('/api/portal/projects').set('Authorization', clientA);
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    const p = res.body.projects[0];
    expect(p.id).toBe('pA');
    expect(p.waitingOnClient).toBe(true);
    expect(p.lastActivity).toBeTruthy();
  });

  it('start-new-project request emails the agency owner', async () => {
    const before = sentEmails.length;
    const res = await request(app)
      .post('/api/portal/requests')
      .set('Authorization', clientA)
      .send({ title: 'Q3 launch video', details: '60s cut for the launch' });
    expect(res.status).toBe(201);
    expect(sentEmails.length).toBe(before + 1);
    expect(sentEmails.at(-1).to).toBe('a@agency.com');
    expect(sentEmails.at(-1).subject).toContain('Q3 launch video');
  });

  it('faq endpoint returns config-driven content', async () => {
    const res = await request(app).get('/api/portal/faq').set('Authorization', clientA);
    expect(res.status).toBe(200);
    expect(res.body.faq.length).toBeGreaterThan(3);
    expect(res.body.contact.email).toBeTruthy();
  });
});

// Runs LAST — archiving pA would break the dashboard/messaging tests above.
describe('project archival', () => {
  it('archived projects leave the default dashboard but appear under ?status=ARCHIVED', async () => {
    const arch = await request(app).post('/api/projects/pA/archive').set('Authorization', adminA);
    expect(arch.status).toBe(200);
    expect(arch.body.project.status).toBe('ARCHIVED');

    const active = await request(app).get('/api/portal/projects').set('Authorization', clientA);
    expect(active.body.projects).toHaveLength(0);

    const archived = await request(app)
      .get('/api/portal/projects?status=ARCHIVED')
      .set('Authorization', clientA);
    expect(archived.body.projects.map((p: any) => p.id)).toEqual(['pA']);

    expect(db.activityEvent.some((a) => a.projectId === 'pA' && a.type === 'PROJECT_ARCHIVED')).toBe(true);
  });
});
