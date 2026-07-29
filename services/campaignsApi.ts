import { apiGet, apiDownload } from './apiClient';

/**
 * Campaign recipient reads, backed by GET /api/campaigns/:id/recipients
 * (server/src/campaigns/routes.ts).
 *
 * That endpoint has existed and worked since the wizard landed but had no
 * caller: the campaign list's "Download CSV" buttons had no onClick, and the
 * detail view read `campaign.recipients`, which `toClientCampaign` hardcodes to
 * `[]` on every response — so every campaign reported "0 Recipients" and an
 * empty table however many leads had been imported. The natural read of that is
 * "the import failed", and the natural remedy is to import again.
 *
 * Recipients are deliberately NOT folded into the campaign list payload: a
 * 5,000-row campaign would then be serialised on every list render.
 */

/** Mirrors the row shape built in campaigns/routes.ts's GET /:id/recipients. */
export interface CampaignRecipientRow {
  id: string;
  leadId: string;
  email: string;
  name: string;
  company: string;
  status: 'PENDING' | 'SENDING' | 'IN_SEQUENCE' | 'COMPLETED' | 'REPLIED' | 'FAILED' | 'SKIPPED';
  currentStep: number;
  attemptCount: number;
  lastSentAt: string | null;
  lastError: string | null;
}

export const fetchCampaignRecipients = (campaignId: string) =>
  apiGet<{ recipients: CampaignRecipientRow[] }>(`/api/campaigns/${campaignId}/recipients`);

/** Same endpoint with ?format=csv, saved as <campaign name>_recipients.csv. */
export const downloadCampaignRecipientsCsv = (campaignId: string, campaignName: string) =>
  apiDownload(
    `/api/campaigns/${campaignId}/recipients?format=csv`,
    // Matches the filename the server sets in Content-Disposition.
    `${campaignName.replace(/[^a-z0-9_-]+/gi, '_')}_recipients.csv`,
  );
