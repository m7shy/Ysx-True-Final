import { describe, it, expect } from 'vitest';

import {
  complianceFooter,
  buildTrackedEmail,
  DEFAULT_PROVENANCE,
  type SenderIdentity,
} from '../campaigns/trackedHtml.js';
import { emailHash } from '../leads/suppression.js';

/**
 * The legal footer. These assertions are deliberately about CONTENT — that the
 * postal address is physically present in the bytes that get sent — not about
 * a function having been called. Every campaign email this system sent before
 * this change was missing a postal address (CAN-SPAM §7704(a)(5)), and the
 * reason nobody noticed is that nothing anywhere asserted on the rendered
 * output.
 */

const IDENTITY: SenderIdentity = {
  businessName: 'YSX Visuals',
  businessAddress: '12 Example Street\nCairo 11835\nEgypt',
  senderProvenance: null,
};

describe('compliance footer', () => {
  it('puts the business name and full postal address in the plain-text part', () => {
    const { text } = complianceFooter(IDENTITY, 'https://crm.example.com/t/u/tok');

    expect(text).toContain('YSX Visuals');
    // Every line of a multi-line address must survive, not just the first.
    expect(text).toContain('12 Example Street');
    expect(text).toContain('Cairo 11835');
    expect(text).toContain('Egypt');
  });

  it('puts the business name and full postal address in the HTML part', () => {
    const { html } = complianceFooter(IDENTITY, 'https://crm.example.com/t/u/tok');

    expect(html).toContain('YSX Visuals');
    expect(html).toContain('12 Example Street');
    expect(html).toContain('Cairo 11835');
    expect(html).toContain('Egypt');
    // A multi-line address collapsed onto one line stops reading as an address.
    expect(html).toContain('<br>');
  });

  it('includes a visible unsubscribe link in both parts, not just the header', () => {
    const url = 'https://crm.example.com/t/u/tok';
    const { text, html } = complianceFooter(IDENTITY, url);

    expect(text).toContain(url);
    expect(html).toContain(`href="${url}"`);
  });

  it('falls back to the default Art 14 disclosure when the tenant has not written one', () => {
    const { text } = complianceFooter(IDENTITY, 'https://x/t/u/t');
    expect(text).toContain(DEFAULT_PROVENANCE);
  });

  it('uses the tenant\'s own disclosure when set, instead of the default', () => {
    const { text } = complianceFooter(
      { ...IDENTITY, senderProvenance: 'We found you in the public XYZ directory.' },
      'https://x/t/u/t',
    );

    expect(text).toContain('We found you in the public XYZ directory.');
    expect(text).not.toContain(DEFAULT_PROVENANCE);
  });

  it('treats a whitespace-only disclosure as unset rather than rendering a blank line', () => {
    const { text } = complianceFooter({ ...IDENTITY, senderProvenance: '   ' }, 'https://x/t/u/t');
    expect(text).toContain(DEFAULT_PROVENANCE);
  });

  it('escapes HTML in tenant-supplied identity fields', () => {
    const { html } = complianceFooter(
      { businessName: '<script>alert(1)</script>', businessAddress: '1 A & B St', senderProvenance: null },
      'https://x/t/u/t',
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('1 A &amp; B St');
  });
});

describe('buildTrackedEmail carries the footer', () => {
  const base = {
    recipientId: 'r1',
    subject: 'hello',
    body: 'Hi there, take a look at https://example.com',
    plainTextMode: false,
    openTracking: false,
    linkTracking: false,
    identity: IDENTITY,
  };

  it('appends the postal address to a normal campaign send', () => {
    const out = buildTrackedEmail(base);

    expect(out.text).toContain('12 Example Street');
    expect(out.html).toContain('12 Example Street');
  });

  it('appends the postal address in plain-text mode too', () => {
    const out = buildTrackedEmail({ ...base, plainTextMode: true });

    expect(out.text).toContain('12 Example Street');
    expect(out.html).toBeUndefined();
  });

  it('omits the footer only when the caller defers it to send time', () => {
    // The auto-follow-up scheduler renders bodies days before they go out, so
    // it opts out here and the send path stamps the CURRENT address instead.
    // If this ever silently flipped to true, queued follow-ups would carry two
    // footers; if it flipped to always-append, they would carry a stale one.
    const out = buildTrackedEmail({ ...base, includeFooter: false });

    expect(out.text).not.toContain('12 Example Street');
    expect(out.html).not.toContain('12 Example Street');
    // The unsubscribe URL is still produced, because the send path needs it to
    // build both the header and the footer.
    expect(out.unsubscribeUrl).toContain('/t/u/');
  });

  it('keeps the opt-out link out of click tracking', () => {
    const out = buildTrackedEmail({ ...base, linkTracking: true });

    // The body URL is rewritten...
    expect(out.text).toContain('/t/c/');
    // ...but the unsubscribe link is not, or opting out would register as
    // engagement and would break entirely if tracking were disabled.
    expect(out.text).toContain(out.unsubscribeUrl);
    expect(out.unsubscribeUrl).not.toContain('/t/c/');
  });
});

describe('suppression hashing', () => {
  it('is case- and whitespace-insensitive, so an opt-out cannot be defeated by casing', () => {
    expect(emailHash('  Bob@Example.COM ')).toBe(emailHash('bob@example.com'));
  });

  it('does not conflate distinct addresses', () => {
    // Deliberately NOT normalising plus-tags or Gmail dots: guessing that two
    // addresses are "really" the same risks suppressing someone who never asked.
    expect(emailHash('bob+news@example.com')).not.toBe(emailHash('bob@example.com'));
    expect(emailHash('b.ob@example.com')).not.toBe(emailHash('bob@example.com'));
  });

  it('stores no plaintext — the key is a hex digest, not the address', () => {
    const h = emailHash('bob@example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('bob');
    expect(h).not.toContain('@');
  });
});
