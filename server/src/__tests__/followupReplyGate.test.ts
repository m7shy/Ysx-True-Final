// FILE: server/src/__tests__/followupReplyGate.test.ts
//
// The reply gate in sendFollowupJob (index.ts) — what happens to a scheduled
// follow-up depending on what the reply check could determine.
//
// This tests the WIRING, deliberately. replyCheck.test.ts already proves
// checkRecipientReply returns 'unknown' when IMAP is unreachable; that proved
// nothing about whether anyone acts on it. The dead content-type guard fixed
// earlier in this session was exactly that failure — a rule with a passing unit
// test and no caller — so the three states are asserted here through the real
// dispatch function.
//
// The states and why each is what it is:
//   'replied'  → cancel the recipient's remaining sequence
//   'no-reply' → send
//   'unknown'  → defer: never send, never cancel. Sending was the old
//                behaviour (every error path returned false = "has not
//                replied"), so an IMAP outage mailed the whole sequence to
//                everyone including people who had already replied. Cancelling
//                would be worse, since one outage would tear down every
//                in-flight sequence permanently.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignStatus, FollowupJobStatus } from '@prisma/client';

const { db, mocks } = vi.hoisted(() => ({
  db: { followupJobs: new Map<string, any>() },
  mocks: {
    checkRecipientReply: vi.fn(),
    sendSmtpMail: vi.fn(async () => ({ messageId: 'sent-id' })),
    cancelFollowup: vi.fn(async () => {}),
    cancelRemainingFollowupsForRecipient: vi.fn(async () => {}),
  },
}));

/** An ACTIVE campaign with no send-window restrictions, so the reply gate is reached. */
function activeCampaign() {
  return {
    id: 'camp1',
    userId: 'u1',
    status: CampaignStatus.ACTIVE,
    sendWindowStart: null,
    sendWindowEnd: null,
    sendDays: null,
    timezone: null,
    stopOnReply: true,
  };
}

vi.mock('../db/prisma.js', () => ({
  prisma: {
    lead: { findFirst: async () => null },
    campaign: {
      findFirst: async () => activeCampaign(),
      findUnique: async () => activeCampaign(),
      update: async () => activeCampaign(),
      updateMany: async () => ({ count: 1 }),
    },
    followupJob: {
      updateMany: async ({ where, data }: any) => {
        const row = db.followupJobs.get(where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      update: async ({ where, data }: any) => {
        const row = db.followupJobs.get(where.id) ?? {};
        Object.assign(row, data);
        return row;
      },
    },
  },
}));

vi.mock('../leads/suppression.js', () => ({
  isSuppressed: async () => false,
  suppress: async () => {},
}));

vi.mock('../mail/replyCheck.js', () => ({
  checkRecipientReply: mocks.checkRecipientReply,
  formatMessageIdForHeader: (v: unknown) => (v ? `<${v}>` : undefined),
  normalizeMessageId: (v: unknown) => String(v ?? ''),
}));

vi.mock('../mail/smtpGateway.js', () => ({
  sendSmtpMail: mocks.sendSmtpMail,
  parseProvider: (v: unknown) => (String(v) === 'microsoft' ? 'microsoft' : 'gmail'),
  getImapConfig: async () => ({ host: 'x', port: 993, secure: true, auth: {} }),
}));

vi.mock('../scheduler/followupScheduler.js', () => ({
  startFollowupScheduler: () => {},
  cancelFollowup: mocks.cancelFollowup,
  cancelRemainingFollowupsForRecipient: mocks.cancelRemainingFollowupsForRecipient,
  cancelScheduledFollowupsForUserRecipient: async () => [],
  scheduleFollowup: async () => ({}),
}));

const { sendFollowupJob } = await import('../index.js');

const JOB_ID = 'job-1';

function makeJob(overrides: Record<string, unknown> = {}) {
  const job = {
    id: JOB_ID,
    userId: 'u1',
    provider: 'gmail',
    to: 'prospect@example.com',
    recipientEmail: 'prospect@example.com',
    subject: 'Following up',
    body: 'hello again',
    campaignId: 'camp1',
    skipIfReplied: true,
    initialSentAt: new Date('2026-07-27T16:00:00Z').toISOString(),
    originalMessageId: 'original-id',
    status: FollowupJobStatus.SENDING,
    scheduledAt: new Date('2026-07-28T09:00:00Z'),
    ...overrides,
  };
  db.followupJobs.set(JOB_ID, { ...job });
  return job;
}

beforeEach(() => {
  db.followupJobs.clear();
  vi.clearAllMocks();
  mocks.sendSmtpMail.mockResolvedValue({ messageId: 'sent-id' } as any);
});

describe('follow-up reply gate', () => {
  it('sends when the check confirms there was no reply', async () => {
    mocks.checkRecipientReply.mockResolvedValue('no-reply');

    await sendFollowupJob(makeJob());

    expect(mocks.sendSmtpMail).toHaveBeenCalledTimes(1);
  });

  it('cancels the remaining sequence when the recipient replied', async () => {
    mocks.checkRecipientReply.mockResolvedValue('replied');

    await sendFollowupJob(makeJob());

    expect(mocks.sendSmtpMail).not.toHaveBeenCalled();
    expect(mocks.cancelRemainingFollowupsForRecipient).toHaveBeenCalled();
  });

  describe('when the reply check could not complete', () => {
    it('does NOT send the follow-up', async () => {
      // The whole point. Before the fix this sent, because the failure was
      // indistinguishable from "they have not replied".
      mocks.checkRecipientReply.mockResolvedValue('unknown');

      await sendFollowupJob(makeJob());

      expect(mocks.sendSmtpMail).not.toHaveBeenCalled();
    });

    it('does NOT cancel the sequence', async () => {
      // Guards the over-correction. Treating 'unknown' as 'replied' would make
      // a single IMAP outage permanently destroy every in-flight sequence.
      mocks.checkRecipientReply.mockResolvedValue('unknown');

      await sendFollowupJob(makeJob());

      expect(mocks.cancelRemainingFollowupsForRecipient).not.toHaveBeenCalled();
      expect(mocks.cancelFollowup).not.toHaveBeenCalled();
    });

    it('reschedules the job for a later retry instead of dropping it', async () => {
      mocks.checkRecipientReply.mockResolvedValue('unknown');
      const before = Date.now();

      await sendFollowupJob(makeJob());

      const row = db.followupJobs.get(JOB_ID);
      expect(row.status).toBe(FollowupJobStatus.SCHEDULED);
      expect(new Date(row.scheduledAt).getTime()).toBeGreaterThan(before);
    });
  });
});
