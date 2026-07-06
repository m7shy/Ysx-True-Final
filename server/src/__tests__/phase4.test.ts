import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { prismaMock, sendFromMailbox, scheduleFollowup } = vi.hoisted(() => ({
  prismaMock: {
    mailbox: { findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    lead: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    campaign: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  sendFromMailbox: vi.fn(async (..._args: any[]) => '<msg-id-1@test>'),
  scheduleFollowup: vi.fn(async (input: any) => input),
}));

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));

vi.mock('../mail/smtpGateway.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendFromMailbox,
}));

vi.mock('../scheduler/followupScheduler.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  scheduleFollowup,
}));

import { resolveSpintax } from '../campaigns/spintax.js';
import { classifyReplyIntentHeuristic, classifyReplyIntent } from '../unibox/intent.js';
import { pickRotationMailbox } from '../creds/mailboxStore.js';
import { campaignTickOnce } from '../campaigns/worker.js';

const today = new Date(Date.UTC(2026, 6, 6));
const yesterday = new Date(Date.UTC(2026, 6, 5));

function mailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mb1',
    userId: 'u1',
    email: 'a@x.com',
    provider: 'GMAIL',
    dailyLimit: 50,
    sentToday: 0,
    counterDate: today,
    lastSentAt: null,
    isActive: true,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Spintax ───────────────────────────────────────────────────────────────────

describe('resolveSpintax', () => {
  it('resolves a group to one of its alternatives', () => {
    for (let i = 0; i < 20; i++) {
      const out = resolveSpintax('{Hi|Hey|Hello} there');
      expect(['Hi there', 'Hey there', 'Hello there']).toContain(out);
    }
  });

  it('resolves nested groups', () => {
    for (let i = 0; i < 20; i++) {
      const out = resolveSpintax('{A|{B|C} D}');
      expect(['A', 'B D', 'C D']).toContain(out);
    }
  });

  it('leaves non-spintax braces (placeholders) untouched', () => {
    expect(resolveSpintax('Hi {firstName}, {quick|short} one')).toMatch(
      /^Hi \{firstName\}, (quick|short) one$/,
    );
  });

  it('passes plain text through unchanged', () => {
    expect(resolveSpintax('no braces here')).toBe('no braces here');
  });
});

// ── Intent classification ────────────────────────────────────────────────────

describe('reply intent', () => {
  it('categorizes with the keyword heuristic', () => {
    expect(classifyReplyIntentHeuristic('I am out of office until Monday')).toBe('OUT_OF_OFFICE');
    expect(classifyReplyIntentHeuristic('Not interested, please remove me')).toBe('NOT_INTERESTED');
    expect(classifyReplyIntentHeuristic('Sounds great, can we book a call?')).toBe('INTERESTED');
    expect(classifyReplyIntentHeuristic('Who gave you my address?')).toBe('NEUTRAL');
  });

  it('falls back to the heuristic when GEMINI_API_KEY is unset', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(classifyReplyIntent('tell me more about pricing')).resolves.toBe('INTERESTED');
  });
});

// ── Inbox rotation ────────────────────────────────────────────────────────────

describe('pickRotationMailbox', () => {
  it('picks the least-recently-used mailbox under its daily limit', async () => {
    // prisma orders by lastSentAt asc nulls first; the mock returns pre-ordered rows.
    prismaMock.mailbox.findMany.mockResolvedValue([
      mailbox({ id: 'exhausted', sentToday: 50 }), // at limit → skipped
      mailbox({ id: 'unwarmed', dailyLimit: 0 }), // limit 0 → skipped
      mailbox({ id: 'lru', sentToday: 3 }),
      mailbox({ id: 'recent', sentToday: 1, lastSentAt: new Date() }),
    ]);
    const picked = await pickRotationMailbox('u1');
    expect(picked?.id).toBe('lru');
  });

  it('treats a stale counterDate as a reset counter', async () => {
    prismaMock.mailbox.findMany.mockResolvedValue([
      mailbox({ id: 'stale', sentToday: 50, counterDate: yesterday }),
    ]);
    const picked = await pickRotationMailbox('u1');
    expect(picked?.id).toBe('stale');
  });

  it('returns null when every mailbox is exhausted', async () => {
    prismaMock.mailbox.findMany.mockResolvedValue([mailbox({ sentToday: 50 })]);
    await expect(pickRotationMailbox('u1')).resolves.toBeNull();
  });
});

// ── Campaign worker ───────────────────────────────────────────────────────────

describe('campaignTickOnce', () => {
  it('dispatches to NEW leads, schedules followups, and completes the campaign', async () => {
    const campaign = {
      id: 'c1',
      userId: 'u1',
      subject: '{Hi|Hey} {firstName}',
      body: 'Quick question',
      autoFollowUps: [{ delay: 3, unit: 'days', content: 'Bumping this {up|to the top}' }],
      createdAt: new Date(),
    };
    const leads = [
      { id: 'l1', userId: 'u1', email: 'lead1@x.com', status: 'NEW' },
      { id: 'l2', userId: 'u1', email: 'lead2@x.com', status: 'NEW' },
    ];

    prismaMock.campaign.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.campaign.findMany.mockResolvedValue([campaign]);
    prismaMock.campaign.update.mockResolvedValue({});
    prismaMock.lead.count
      .mockResolvedValueOnce(2) // total leads
      .mockResolvedValueOnce(2); // remaining NEW before batch
    prismaMock.lead.findMany.mockResolvedValue(leads);
    prismaMock.lead.update.mockResolvedValue({});
    // Rotation: alternate between two mailboxes.
    prismaMock.mailbox.findMany
      .mockResolvedValueOnce([mailbox({ id: 'mbA' }), mailbox({ id: 'mbB', lastSentAt: new Date() })])
      .mockResolvedValueOnce([mailbox({ id: 'mbB' }), mailbox({ id: 'mbA', lastSentAt: new Date() })]);
    prismaMock.mailbox.update.mockResolvedValue({});

    await campaignTickOnce();

    // Both leads got an email, each from a different (rotated) mailbox.
    expect(sendFromMailbox).toHaveBeenCalledTimes(2);
    expect(sendFromMailbox.mock.calls.map((c: any[]) => c[0].id).sort()).toEqual(['mbA', 'mbB']);

    // Spintax was resolved in the subject.
    const subjects = sendFromMailbox.mock.calls.map((c: any[]) => c[1].subject);
    for (const s of subjects) expect(s).toMatch(/^(Hi|Hey) \{firstName\}$/);

    // One reply-gated followup per lead, threaded on the sent message.
    expect(scheduleFollowup).toHaveBeenCalledTimes(2);
    const fu = scheduleFollowup.mock.calls[0][0];
    expect(fu.skipIfReplied).toBe(true);
    expect(fu.campaignId).toBe('c1');
    expect(fu.originalMessageId).toBe('<msg-id-1@test>');

    // Leads marked CONTACTED and campaign COMPLETED at 100%.
    expect(prismaMock.lead.update).toHaveBeenCalledTimes(2);
    const finalCampaignUpdate = prismaMock.campaign.update.mock.calls.at(-1)![0];
    expect(finalCampaignUpdate.data.status).toBe('COMPLETED');
    expect(finalCampaignUpdate.data.progress).toBe(100);
  });
});
