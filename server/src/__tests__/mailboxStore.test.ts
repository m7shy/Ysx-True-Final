import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailboxProvider, type Mailbox } from '@prisma/client';

vi.hoisted(() => {
  process.env.MAILBOX_ENCRYPTION_KEY = '0'.repeat(64);
});

const { prismaMock, refreshAccessTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    mailbox: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  refreshAccessTokenMock: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../creds/oauth.js', () => ({
  refreshAccessToken: refreshAccessTokenMock,
}));

import { ensureFreshAccessToken } from '../creds/mailboxStore.js';
import { encryptSecret } from '../creds/crypto.js';
import { MailError } from '../httpErrors.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureFreshAccessToken concurrency and resilience', () => {
  it('deduplicates concurrent refresh calls for the same mailbox id (performs only ONE refresh)', async () => {
    const expiredDate = new Date(Date.now() - 10000);
    const mailbox: Mailbox = {
      id: 'mb_concurrent_1',
      userId: 'u1',
      email: 'test@example.com',
      provider: MailboxProvider.GMAIL,
      accessToken: encryptSecret('old_access'),
      refreshToken: encryptSecret('old_refresh'),
      scope: 'https://mail.google.com/',
      tokenType: 'Bearer',
      tenant: null,
      obtainedAt: new Date(Date.now() - 3600000),
      expiresAt: expiredDate,
      dailyLimit: 30,
      sentToday: 0,
      counterDate: new Date(),
      lastSentAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Return current row as-is when findUnique is called during refresh check
    prismaMock.mailbox.findUnique.mockResolvedValue(mailbox);
    prismaMock.mailbox.update.mockResolvedValue({ ...mailbox, accessToken: encryptSecret('new_access') });

    // Mock refreshAccessToken to take 50ms to simulate inflight HTTP request
    refreshAccessTokenMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        accessToken: 'new_access',
        refreshToken: 'new_refresh',
        expiresAt: new Date(Date.now() + 3600000),
      };
    });

    const [res1, res2] = await Promise.all([
      ensureFreshAccessToken(mailbox),
      ensureFreshAccessToken(mailbox),
    ]);

    expect(res1).toBe('new_access');
    expect(res2).toBe('new_access');
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT deactivate mailbox when invalid_grant coincides with a concurrent successful rotation', async () => {
    const expiredDate = new Date(Date.now() - 10000);
    const mailbox: Mailbox = {
      id: 'mb_race_2',
      userId: 'u1',
      email: 'race@example.com',
      provider: MailboxProvider.MICROSOFT,
      accessToken: encryptSecret('stale_access'),
      refreshToken: encryptSecret('stale_refresh'),
      scope: null,
      tokenType: 'Bearer',
      tenant: null,
      obtainedAt: new Date(Date.now() - 3600000),
      expiresAt: expiredDate,
      dailyLimit: 30,
      sentToday: 0,
      counterDate: new Date(),
      lastSentAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Caller 1 presents stale_refresh to provider -> provider returns revoked/invalid_grant
    refreshAccessTokenMock.mockRejectedValue(
      new MailError('AUTH', 'invalid_grant: AADSTS700084: The refresh token has expired', true),
    );

    // But when re-reading DB to corroborate, another concurrent caller ALREADY rotated refresh token!
    const rotatedMailbox: Mailbox = {
      ...mailbox,
      accessToken: encryptSecret('concurrent_fresh_access'),
      refreshToken: encryptSecret('concurrent_fresh_refresh'),
      expiresAt: new Date(Date.now() + 3600000),
    };
    prismaMock.mailbox.findUnique.mockResolvedValue(rotatedMailbox);

    const token = await ensureFreshAccessToken(mailbox);

    // Must return the fresh access token from the concurrent rotation
    expect(token).toBe('concurrent_fresh_access');

    // Must NOT deactivate the mailbox
    expect(prismaMock.mailbox.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });
});
