// FILE: test/campaignDetailRecipients.test.tsx
//
// The campaign detail view must show the campaign's real recipients.
//
// `toClientCampaign` (server/src/campaigns/routes.ts) hardcodes
// `recipients: []` on every campaign response — deliberately, so a 5,000-row
// campaign is not serialised into every list render — and the detail view read
// exactly that field. Every campaign therefore reported "0 Recipients" and an
// empty table however many leads had been imported, which reads as a failed
// import and invites a re-import. Meanwhile GET /api/campaigns/:id/recipients
// existed, worked, and had no caller at all.
//
// The per-row status badge was separately hardcoded to "Pending", so even a
// fully-sent campaign looked untouched.
//
// Mutation coverage, verified by performing each mutation:
//  - rendering `campaign.recipients` instead of the fetched rows fails
//    "renders the fetched recipients, not the empty array on the campaign";
//  - restoring the hardcoded <Badge>Pending</Badge> fails "shows each
//    recipient's real status".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchCampaignRecipients = vi.fn();
vi.mock('../services/campaignsApi', () => ({
  fetchCampaignRecipients: (...a: unknown[]) => fetchCampaignRecipients(...a),
  downloadCampaignRecipientsCsv: vi.fn(),
}));

import { CampaignDetailView } from '../components/CampaignDetailView';
import type { Campaign } from '../types';

const CAMPAIGN: Campaign = {
  id: 'camp_1',
  name: 'Q3 Outreach',
  createdAt: new Date('2026-07-01T10:00:00Z').toISOString(),
  status: 'ACTIVE',
  // Always [] from the server — the point of the fix is that this is not what
  // gets rendered.
  recipients: [],
  subject: 'Hello',
  body: 'Body',
  scheduledAt: new Date('2026-07-02T10:00:00Z').toISOString(),
  progress: 40,
  stats: { sent: 12, clicked: 3, replied: 2, opportunities: 1 },
  distributionMethod: 'INDIVIDUAL',
  autoFollowUps: [],
};

const row = (over: Partial<any> = {}) => ({
  id: 'cr_1',
  leadId: 'lead_1',
  email: 'dana@acme.test',
  name: 'Dana Vale',
  company: 'Acme',
  status: 'PENDING',
  currentStep: 0,
  attemptCount: 0,
  lastSentAt: null,
  lastError: null,
  ...over,
});

beforeEach(() => {
  fetchCampaignRecipients.mockReset();
  fetchCampaignRecipients.mockResolvedValue({ recipients: [] });
});

const openRecipientsTab = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Recipients' }));
};

describe('CampaignDetailView — recipients', () => {
  it('renders the fetched recipients, not the empty array on the campaign', async () => {
    fetchCampaignRecipients.mockResolvedValue({
      recipients: [
        row(),
        row({ id: 'cr_2', email: 'sam@bolt.test', name: 'Sam Ito', company: 'Bolt', status: 'REPLIED' }),
      ],
    });

    render(<CampaignDetailView campaign={CAMPAIGN} onBack={vi.fn()} />);

    await waitFor(() => expect(fetchCampaignRecipients).toHaveBeenCalledWith('camp_1'));
    // The header count comes from the fetch, not from campaign.recipients.length.
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());

    await openRecipientsTab();
    expect(screen.getByText('Dana Vale')).toBeInTheDocument();
    expect(screen.getByText('sam@bolt.test')).toBeInTheDocument();
  });

  it('shows each recipient\'s real status', async () => {
    fetchCampaignRecipients.mockResolvedValue({
      recipients: [
        row({ status: 'COMPLETED' }),
        row({ id: 'cr_2', email: 'sam@bolt.test', name: 'Sam Ito', status: 'FAILED' }),
      ],
    });

    render(<CampaignDetailView campaign={CAMPAIGN} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchCampaignRecipients).toHaveBeenCalled());
    await openRecipientsTab();

    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    // The old hardcoded badge.
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('renders an unknown status rather than crashing on it', async () => {
    // The server owns RecipientStatus; a value added there and not here must
    // degrade, not white-screen. This is the third instance of that class in
    // this repo, so it gets a test on arrival rather than after the outage.
    fetchCampaignRecipients.mockResolvedValue({
      recipients: [row({ status: 'QUARANTINED' })],
    });

    render(<CampaignDetailView campaign={CAMPAIGN} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchCampaignRecipients).toHaveBeenCalled());
    await openRecipientsTab();

    expect(screen.getByText('QUARANTINED')).toBeInTheDocument();
  });

  it('says so when the recipients cannot be loaded', async () => {
    // Distinguishable from a genuinely empty campaign — the confusion that
    // made the original bug invite a re-import.
    fetchCampaignRecipients.mockRejectedValue(new Error('Network unreachable'));

    render(<CampaignDetailView campaign={CAMPAIGN} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchCampaignRecipients).toHaveBeenCalled());
    await openRecipientsTab();

    expect(screen.getByText(/Network unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/No recipients on this campaign yet/i)).not.toBeInTheDocument();
  });

  it('shows an empty state for a campaign with genuinely no recipients', async () => {
    render(<CampaignDetailView campaign={CAMPAIGN} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchCampaignRecipients).toHaveBeenCalled());
    await openRecipientsTab();

    expect(screen.getByText(/No recipients on this campaign yet/i)).toBeInTheDocument();
  });
});
