// FILE: server/src/campaigns/trackedHtml.ts
//
// Builds the { text, html } pair sent through smtpGateway's SmtpSendInput,
// rewriting links through the click-tracking redirect and appending an open
// pixel when the campaign has tracking enabled. In plainTextMode there is no
// HTML part at all, so the open pixel is physically impossible — link
// tracking still rewrites raw URLs in the text body.

import { config } from '../config.js';
import { signTrackingToken, signClickToken } from './trackingToken.js';

function publicBaseUrl(): string {
  return (config.PUBLIC_BASE_URL || config.OAUTH_REDIRECT_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function clickUrl(recipientId: string, target: string): string {
  // The token is signed over BOTH recipientId and target, so swapping ?u=
  // in a received email will invalidate the signature (verifyClickToken).
  // The exact same `target` string is passed to both sign and encode, so
  // there is no mismatch between the value that was signed and the value
  // embedded in the URL.
  const clickToken = signClickToken(recipientId, target);
  return `${publicBaseUrl()}/t/c/${clickToken}?u=${Buffer.from(target).toString('base64url')}`;
}

function rewriteLinks(text: string, recipientId: string): string {
  return text.replace(URL_RE, (url) => clickUrl(recipientId, url));
}

/**
 * The tenant's legal sender identity, resolved from User at send time.
 *
 * Not optional-by-omission anywhere it matters: `assertSenderIdentity` (see
 * senderIdentity.ts) refuses to dispatch a campaign without one, so the footer
 * builder can assume it is present rather than silently degrading to a
 * non-compliant email — a footer that quietly drops the address is exactly the
 * failure mode that produced this work.
 */
export interface SenderIdentity {
  businessName: string;
  businessAddress: string;
  /** Art 14 sourcing disclosure; null → DEFAULT_PROVENANCE. */
  senderProvenance?: string | null;
}

/**
 * Default GDPR Art 14 disclosure.
 *
 * Art 14 applies because these addresses were NOT collected from the data
 * subject — they were scraped from public YouTube channels — which obliges us
 * to say so, and to say it in the first communication. A tenant can override
 * the wording, but never opt out of having one.
 */
export const DEFAULT_PROVENANCE =
  "You're receiving this because your channel's contact address is listed publicly on YouTube. " +
  'Reply "STOP" and we will delete your details.';

/**
 * Render the legal footer shared by every commercial send.
 *
 * ONE builder, called by both the initial send and the follow-up sender. They
 * used to differ — follow-ups carried the RFC 8058 header but no visible
 * unsubscribe link and no postal address at all — and two copies of one rule
 * drifting apart is a trap this repo has already been caught by twice. Anything
 * that must appear in every commercial message belongs here and nowhere else.
 */
export function complianceFooter(
  identity: SenderIdentity,
  unsubscribeUrl: string,
): { text: string; html: string } {
  const provenance = identity.senderProvenance?.trim() || DEFAULT_PROVENANCE;
  const address = identity.businessAddress.trim();

  const text =
    `\n\n—\n${provenance}\n` +
    `Don't want these emails? Unsubscribe: ${unsubscribeUrl}\n\n` +
    `${identity.businessName.trim()}\n${address}`;

  const html =
    `\n<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:24px 0">\n` +
    `<p style="margin:0 0 8px;font-size:12px;color:#8b95a5">${escapeHtml(provenance)}</p>\n` +
    `<p style="margin:0 0 8px;font-size:12px;color:#8b95a5">` +
    `Don't want these emails? <a href="${unsubscribeUrl}" style="color:#8b95a5">Unsubscribe</a></p>\n` +
    `<p style="margin:0;font-size:12px;color:#8b95a5">` +
    `${escapeHtml(identity.businessName.trim())}<br>\n` +
    // The postal address must survive as separate lines in HTML, or a
    // multi-line address renders as one run-on line and stops reading as an
    // address at all.
    `${escapeHtml(address).replace(/\r?\n/g, '<br>\n')}</p>`;

  return { text, html };
}

export interface TrackedEmailInput {
  recipientId: string;
  subject: string;
  body: string;
  plainTextMode: boolean;
  openTracking: boolean;
  linkTracking: boolean;
  identity: SenderIdentity;
  /**
   * Append the legal footer here. Default true.
   *
   * Set false ONLY by the auto-follow-up scheduler, which pre-renders a body
   * at schedule time but has it stamped with the footer at SEND time instead
   * (see sendFollowupJob). Two reasons the footer moved: a queued follow-up
   * would otherwise freeze the tenant's postal address as it was days earlier,
   * and follow-ups queued through POST /api/followups/schedule never passed
   * through this function at all, so a schedule-time footer could never be
   * unconditional. Appending once at the send path is the only place that
   * covers every way a follow-up can get queued.
   */
  includeFooter?: boolean;
}

export interface TrackedEmail {
  text: string;
  html?: string;
  /** Public one-click opt-out URL for this recipient (for List-Unsubscribe). */
  unsubscribeUrl: string;
}

export function buildTrackedEmail(input: TrackedEmailInput): TrackedEmail {
  // signTrackingToken is used for the pixel and unsubscribe links (no target).
  // signClickToken is used per-link inside clickUrl(), binding the target URL.
  const trackingToken = signTrackingToken(input.recipientId);
  const unsubscribeUrl = `${publicBaseUrl()}/t/u/${trackingToken}`;

  // The compliance footer is appended AFTER link rewriting so the opt-out link
  // never routes through click tracking (a click there must not count as
  // engagement, and must keep working if tracking is off) — and so the postal
  // address is never mangled into a tracked link either.
  const withFooter = input.includeFooter !== false;
  const footer = complianceFooter(input.identity, unsubscribeUrl);

  let text = input.linkTracking ? rewriteLinks(input.body, input.recipientId) : input.body;
  if (withFooter) text += footer.text;

  if (input.plainTextMode) {
    return { text, unsubscribeUrl };
  }

  let html = escapeHtml(input.body).replace(/\n/g, '<br>\n');
  if (input.linkTracking) {
    html = html.replace(URL_RE, (url) => `<a href="${clickUrl(input.recipientId, url)}">${url}</a>`);
  }
  if (withFooter) html += footer.html;
  if (input.openTracking) {
    const pixelUrl = `${publicBaseUrl()}/t/o/${trackingToken}`;
    html += `\n<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  }

  return { text, html, unsubscribeUrl };
}

/** RFC 8058 one-click unsubscribe headers for a campaign send. */
export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Rebuild a recipient's unsubscribe URL from its id — used by the follow-up
 * sender, which only persists campaignId/leadId on the job, not the URL.
 */
export function unsubscribeUrlForRecipient(recipientId: string): string {
  return `${publicBaseUrl()}/t/u/${signTrackingToken(recipientId)}`;
}
