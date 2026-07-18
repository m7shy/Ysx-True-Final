// FILE: server/src/campaigns/trackedHtml.ts
//
// Builds the { text, html } pair sent through smtpGateway's SmtpSendInput,
// rewriting links through the click-tracking redirect and appending an open
// pixel when the campaign has tracking enabled. In plainTextMode there is no
// HTML part at all, so the open pixel is physically impossible — link
// tracking still rewrites raw URLs in the text body.

import { config } from '../config.js';
import { signTrackingToken } from './trackingToken.js';

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

function clickUrl(token: string, target: string): string {
  return `${publicBaseUrl()}/t/c/${token}?u=${Buffer.from(target).toString('base64url')}`;
}

function rewriteLinks(text: string, token: string): string {
  return text.replace(URL_RE, (url) => clickUrl(token, url));
}

export interface TrackedEmailInput {
  recipientId: string;
  subject: string;
  body: string;
  plainTextMode: boolean;
  openTracking: boolean;
  linkTracking: boolean;
}

export interface TrackedEmail {
  text: string;
  html?: string;
  /** Public one-click opt-out URL for this recipient (for List-Unsubscribe). */
  unsubscribeUrl: string;
}

export function buildTrackedEmail(input: TrackedEmailInput): TrackedEmail {
  const token = signTrackingToken(input.recipientId);
  const unsubscribeUrl = `${publicBaseUrl()}/t/u/${token}`;

  // The unsubscribe footer is appended AFTER link rewriting so the opt-out
  // link never routes through click tracking (a click there must not count
  // as engagement, and must keep working if tracking is off).
  let text = input.linkTracking ? rewriteLinks(input.body, token) : input.body;
  text += `\n\n—\nDon't want these emails? Unsubscribe: ${unsubscribeUrl}`;

  if (input.plainTextMode) {
    return { text, unsubscribeUrl };
  }

  let html = escapeHtml(input.body).replace(/\n/g, '<br>\n');
  if (input.linkTracking) {
    html = html.replace(URL_RE, (url) => `<a href="${clickUrl(token, url)}">${url}</a>`);
  }
  html += `\n<p style="margin-top:24px;font-size:12px;color:#8b95a5">` +
    `Don't want these emails? <a href="${unsubscribeUrl}" style="color:#8b95a5">Unsubscribe</a></p>`;
  if (input.openTracking) {
    const pixelUrl = `${publicBaseUrl()}/t/o/${token}`;
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
