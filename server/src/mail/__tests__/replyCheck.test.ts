import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasRecipientReplied, isNotAHumanReply, isDeliveryStatusSender } from '../replyCheck.js';
import { ImapFlow } from 'imapflow';

/**
 * Reply detection.
 *
 * An IMAP search hit is no longer trusted on its own — each candidate is
 * fetched and checked, because two different things were being counted as
 * replies that are not replies:
 *
 *  - a bounce (DSN). The header searches deliberately drop the sender filter,
 *    and an Exchange NDR quotes the original message, so it is exactly the
 *    shape those searches look for. Counting it as a reply cancels the
 *    sequence and files the deadest addresses on the list as engagement.
 *  - a message that arrived BEFORE the initial send. IMAP `SINCE` filters to a
 *    whole day, so anything the contact sent earlier that same morning matched.
 */

vi.mock('imapflow', () => {
  const ImapFlow = vi.fn();
  ImapFlow.prototype.connect = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.mailboxOpen = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.search = vi.fn().mockResolvedValue([]);
  ImapFlow.prototype.logout = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.fetch = vi.fn();
  return { ImapFlow };
});

vi.mock('../smtpGateway.js', () => ({
  getImapConfig: vi.fn().mockReturnValue({
    host: 'imap.example.com',
    port: 993,
    secure: true,
    auth: { user: 'user@example.com', pass: 'secret' },
  }),
}));

const SENT_AT = new Date('2026-07-27T16:00:00Z');

/** A plain human message's BODYSTRUCTURE. */
const HUMAN_BODY = { type: 'text/plain' };

/**
 * An RFC 3464 DSN's BODYSTRUCTURE: multipart/report at the top with a
 * message/delivery-status part beneath. Real bounces carry this whatever
 * address they are sent from, which is the whole point of checking it.
 */
const DSN_BODY = {
  type: 'multipart/report',
  parameters: { 'report-type': 'delivery-status' },
  childNodes: [
    { type: 'text/plain' },
    { type: 'message/delivery-status' },
    { type: 'message/rfc822' },
  ],
};

/** Make client.fetch yield the given messages, as ImapFlow's async iterator does. */
function fetchYields(
  client: any,
  messages: Array<{ from: string; subject?: string; at: Date; bodyStructure?: unknown }>,
) {
  (client.fetch as any).mockImplementation(async function* (_seq: unknown, options: any) {
    for (const m of messages) {
      yield {
        envelope: { from: [{ address: m.from }], subject: m.subject ?? 'Re: hello', date: m.at },
        internalDate: m.at,
        // Mirror IMAP: the server returns BODYSTRUCTURE only when it was asked
        // for. A mock that hands it over unconditionally would let code that
        // forgot to request it still pass — which is exactly the defect these
        // tests exist to catch.
        ...(options?.bodyStructure ? { bodyStructure: m.bodyStructure ?? HUMAN_BODY } : {}),
      };
    }
  });
}

function matchOnInReplyTo(client: any) {
  (client.search as any).mockImplementation((criteria: any) =>
    criteria?.header?.['in-reply-to'] === 'original-id' ? [1] : [],
  );
}

describe('hasRecipientReplied', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new ImapFlow({} as any);
  });

  const call = () =>
    hasRecipientReplied({
      userId: 'test-user',
      provider: 'gmail',
      recipientEmail: 'recipient@test.com',
      initialSentAt: SENT_AT.toISOString(),
      originalMessageId: 'original-id',
    });

  it('detects a genuine reply matched on In-Reply-To', async () => {
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [{ from: 'recipient@test.com', at: new Date('2026-07-27T17:00:00Z') }]);

    expect(await call()).toBe(true);
  });

  it('detects a reply sent from a different alias, since the Message-ID matches', async () => {
    // The sender filter is deliberately dropped for ID-matched searches: a
    // colleague or alias replying on the thread is still a reply.
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [{ from: 'alias@test.com', at: new Date('2026-07-27T17:00:00Z') }]);

    expect(await call()).toBe(true);
  });

  it('does NOT count an Exchange bounce as a reply', async () => {
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [
      {
        from: 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@outreach.example.com',
        subject: 'Undeliverable: Re: hello',
        at: new Date('2026-07-27T17:00:00Z'),
      },
    ]);

    expect(await call()).toBe(false);
  });

  it('does NOT count a mailer-daemon bounce as a reply', async () => {
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [
      { from: 'MAILER-DAEMON@googlemail.com', at: new Date('2026-07-27T17:00:00Z') },
    ]);

    expect(await call()).toBe(false);
  });

  it('does NOT count a message that arrived before the initial send', async () => {
    // Same calendar day, three hours EARLIER — the exact case IMAP's
    // date-granular SINCE cannot exclude.
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [{ from: 'recipient@test.com', at: new Date('2026-07-27T13:00:00Z') }]);

    expect(await call()).toBe(false);
  });

  it('still finds the real reply when a bounce arrives alongside it', async () => {
    matchOnInReplyTo(mockClient);
    fetchYields(mockClient, [
      { from: 'postmaster@test.com', at: new Date('2026-07-27T16:30:00Z') },
      { from: 'recipient@test.com', at: new Date('2026-07-27T17:00:00Z') },
    ]);

    expect(await call()).toBe(true);
  });

  it('returns false when nothing matches', async () => {
    (mockClient.search as any).mockResolvedValue([]);

    expect(await call()).toBe(false);
  });

  // The sender regex catches the bounce senders we know about. These cover the
  // ones we do not: a DSN relayed from an ordinary-looking address still
  // carries multipart/report, and that is what must stop it. Before the fetch
  // requested bodyStructure, isNotAHumanReply's content-type argument was
  // always undefined and none of this was reachable.
  describe('DSN detection by report content type', () => {
    it('does NOT count a bounce from an ordinary-looking sender as a reply', async () => {
      matchOnInReplyTo(mockClient);
      fetchYields(mockClient, [
        {
          from: 'delivery@relay.example.com', // matches no bounce-sender pattern
          subject: 'Re: hello',
          at: new Date('2026-07-27T17:00:00Z'),
          bodyStructure: DSN_BODY,
        },
      ]);

      expect(await call()).toBe(false);
    });

    it('detects the report type when it appears only on a nested part', async () => {
      matchOnInReplyTo(mockClient);
      fetchYields(mockClient, [
        {
          from: 'delivery@relay.example.com',
          at: new Date('2026-07-27T17:00:00Z'),
          bodyStructure: {
            type: 'multipart/mixed',
            childNodes: [{ type: 'text/plain' }, { type: 'message/delivery-status' }],
          },
        },
      ]);

      expect(await call()).toBe(false);
    });

    it('still accepts an ordinary multipart human reply', async () => {
      // Guards the obvious over-correction: rejecting anything multipart.
      matchOnInReplyTo(mockClient);
      fetchYields(mockClient, [
        {
          from: 'recipient@test.com',
          at: new Date('2026-07-27T17:00:00Z'),
          bodyStructure: {
            type: 'multipart/alternative',
            childNodes: [{ type: 'text/plain' }, { type: 'text/html' }],
          },
        },
      ]);

      expect(await call()).toBe(true);
    });

    it('rejects a content-type bounce on the subject-fallback path too', async () => {
      // The fallback carries its own copy of the guard; two copies of one rule
      // is how they drift apart.
      (mockClient.search as any).mockImplementation((criteria: any) => (criteria?.header ? [] : [1]));
      fetchYields(mockClient, [
        {
          from: 'delivery@relay.example.com',
          subject: 'Re: hello',
          at: new Date('2026-07-27T17:00:00Z'),
          bodyStructure: DSN_BODY,
        },
      ]);

      expect(await call()).toBe(false);
    });
  });

  // The subject-based fallback is a THIRD code path, reached only when neither
  // header search hits. It carries its own copy of the DSN and date guards, and
  // a mutation check showed the tests above never exercise it — two copies of
  // one rule where only one is covered is how they drift apart.
  describe('subject fallback path', () => {
    const matchOnSenderOnly = (client: any) =>
      (client.search as any).mockImplementation((criteria: any) => (criteria?.header ? [] : [1]));

    it('accepts a "Re:" reply from the recipient', async () => {
      matchOnSenderOnly(mockClient);
      fetchYields(mockClient, [
        { from: 'recipient@test.com', subject: 'Re: hello', at: new Date('2026-07-27T17:00:00Z') },
      ]);

      expect(await call()).toBe(true);
    });

    it('does NOT accept a bounce whose subject happens to start with "Re:"', async () => {
      matchOnSenderOnly(mockClient);
      fetchYields(mockClient, [
        { from: 'postmaster@test.com', subject: 'Re: hello', at: new Date('2026-07-27T17:00:00Z') },
      ]);

      expect(await call()).toBe(false);
    });

    it('does NOT accept a "Re:" message that predates the initial send', async () => {
      matchOnSenderOnly(mockClient);
      fetchYields(mockClient, [
        { from: 'recipient@test.com', subject: 'Re: hello', at: new Date('2026-07-27T13:00:00Z') },
      ]);

      expect(await call()).toBe(false);
    });
  });
});

describe('delivery-status sender detection', () => {
  it('recognises the standard bounce senders', () => {
    expect(isDeliveryStatusSender('mailer-daemon@example.com')).toBe(true);
    expect(isDeliveryStatusSender('MAILER-DAEMON@Example.COM')).toBe(true);
    expect(isDeliveryStatusSender('postmaster@example.com')).toBe(true);
    expect(isDeliveryStatusSender('MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@x.com')).toBe(true);
    expect(isDeliveryStatusSender('bounces@example.com')).toBe(true);
  });

  it('does not misclassify an ordinary human address', () => {
    expect(isDeliveryStatusSender('jason@creatoreconomy.online')).toBe(false);
    expect(isDeliveryStatusSender('post@example.com')).toBe(false);
    expect(isDeliveryStatusSender('')).toBe(false);
    expect(isDeliveryStatusSender(undefined)).toBe(false);
  });

  it('catches a DSN by its report content type even from an unexpected sender', () => {
    expect(isNotAHumanReply('weird-sender@example.com', 'multipart/report; report-type=delivery-status')).toBe(true);
    expect(isNotAHumanReply('weird-sender@example.com', 'text/plain')).toBe(false);
  });
});
