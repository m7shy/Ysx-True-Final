import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the deep-health watchdog (edge-triggered + throttled
 * alerting) and the portal mailer's SMTP fallback path.
 */

const sent: any[] = [];
const mailboxes: any[] = [];

vi.mock('../db/prisma.js', () => ({
  prisma: {
    $queryRaw: async () => [{ '?column?': 1 }],
    mailbox: {
      findFirst: async () => mailboxes[0] ?? null,
      count: async () => 0,
    },
  },
}));

vi.mock('../mail/smtpGateway.js', () => ({
  sendFromMailbox: async (_mb: any, input: any) => {
    if (_mb.broken) throw new Error('OAuth token refresh failed');
    sent.push({ via: 'mailbox', ...input });
    return 'msg-1';
  },
}));

vi.mock('../mail/smtpClient.js', () => ({
  sendMail: async (opts: any) => {
    sent.push({ via: 'smtp-fallback', to: opts.to, subject: opts.subject, host: opts.host });
    return 'msg-2';
  },
}));

import { config } from '../config.js';
import { sendPortalEmail, smtpFallbackConfigured } from '../portal/mailer.js';
import { watchdogPassWith, type DeepHealth } from '../health/monitor.js';

function health(status: 'ok' | 'degraded' | 'critical', checkStatus: any): DeepHealth {
  return { status, at: new Date().toISOString(), checks: { db: { status: checkStatus, detail: 'x' } } };
}

beforeEach(() => {
  sent.length = 0;
  mailboxes.length = 0;
  config.PORTAL_SMTP_HOST = undefined;
  config.PORTAL_SMTP_USER = undefined;
  config.PORTAL_SMTP_PASS = undefined;
  config.ALERT_EMAIL = undefined;
});

function enableFallback() {
  config.PORTAL_SMTP_HOST = 'smtp.test.local';
  config.PORTAL_SMTP_USER = 'alerts@test.local';
  config.PORTAL_SMTP_PASS = 'pw';
}

describe('portal mailer SMTP fallback', () => {
  it('no mailbox + no fallback → NO_MAILBOX 409 (unchanged behavior)', async () => {
    await expect(sendPortalEmail('u1', { to: 'a@b.c', subject: 's', text: 't' })).rejects.toMatchObject({
      code: 'NO_MAILBOX',
      status: 409,
    });
  });

  it('healthy mailbox is preferred even when fallback is configured', async () => {
    mailboxes.push({ id: 'mb1', isActive: true });
    enableFallback();
    await sendPortalEmail('u1', { to: 'a@b.c', subject: 's', text: 't' });
    expect(sent).toHaveLength(1);
    expect(sent[0].via).toBe('mailbox');
  });

  it('no mailbox + fallback configured → sends via fallback SMTP', async () => {
    enableFallback();
    expect(smtpFallbackConfigured()).toBe(true);
    await sendPortalEmail('u1', { to: 'a@b.c', subject: 's', text: 't' });
    expect(sent).toHaveLength(1);
    expect(sent[0].via).toBe('smtp-fallback');
    expect(sent[0].host).toBe('smtp.test.local');
  });

  it('mailbox send FAILURE falls back to SMTP instead of throwing', async () => {
    mailboxes.push({ id: 'mb1', isActive: true, broken: true });
    enableFallback();
    await sendPortalEmail('u1', { to: 'a@b.c', subject: 's', text: 't' });
    expect(sent).toHaveLength(1);
    expect(sent[0].via).toBe('smtp-fallback');
  });

  it('mailbox send failure with NO fallback still throws (fails loud)', async () => {
    mailboxes.push({ id: 'mb1', isActive: true, broken: true });
    await expect(sendPortalEmail('u1', { to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow(
      'OAuth token refresh failed'
    );
  });
});

describe('watchdog alerting (edge-triggered + throttled)', () => {
  it('alerts on new failure, stays silent while failing, re-alerts after throttle, notices recovery', async () => {
    enableFallback();
    config.ALERT_EMAIL = 'owner@test.local';
    const t0 = Date.now();

    // New failure → one alert email.
    expect(await watchdogPassWith(health('critical', 'critical'), t0)).toEqual(['alert:db']);
    expect(sent.filter((s) => s.via === 'smtp-fallback')).toHaveLength(1);
    expect(sent[0].subject).toContain('db critical');

    // Still failing 10 min later → throttled, no new alert.
    expect(await watchdogPassWith(health('critical', 'critical'), t0 + 10 * 60_000)).toEqual([]);
    expect(sent).toHaveLength(1);

    // Still failing 7h later → throttle expired, re-alert.
    expect(await watchdogPassWith(health('critical', 'critical'), t0 + 7 * 60 * 60_000)).toEqual(['alert:db']);
    expect(sent).toHaveLength(2);

    // Recovery → recovery notice, exactly once.
    expect(await watchdogPassWith(health('ok', 'ok'), t0 + 8 * 60 * 60_000)).toEqual(['recovered:db']);
    expect(sent).toHaveLength(3);
    expect(sent[2].subject).toContain('recovered');
    expect(await watchdogPassWith(health('ok', 'ok'), t0 + 9 * 60 * 60_000)).toEqual([]);
    expect(sent).toHaveLength(3);
  });

  it('without ALERT_EMAIL it records state transitions but sends nothing', async () => {
    enableFallback(); // fallback set but no ALERT_EMAIL
    const t0 = Date.now();
    expect(await watchdogPassWith(health('degraded', 'degraded'), t0)).toEqual(['alert:db']);
    expect(sent).toHaveLength(0);
  });
});
