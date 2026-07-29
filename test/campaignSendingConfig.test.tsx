// FILE: test/campaignSendingConfig.test.tsx
//
// A campaign must be created — and duplicated — with the sending configuration
// the user actually chose.
//
// `addCampaign` posted exactly nine fields (name, subject, body, scheduledAt,
// status, distributionMethod, autoFollowUps, sequence, recipients) and silently
// dropped the other thirteen that the wizard's Setup step collects and passes
// in: the send window, active days, timezone, daily limit, send interval, the
// three stop-on-* rules, plain-text mode, follow-up priority and both tracking
// flags. Every field is optional server-side, so each one quietly fell back to a
// column default and nothing reported a loss. A campaign the user throttled to
// 40/day on weekdays 09:00–18:00 was created sending around the clock, seven
// days a week, with no interval and no cap.
//
// `duplicateCampaign` had the same hole from the other direction: "Copy of X"
// carried none of the original's pacing, so duplicating a throttled campaign
// produced an unthrottled one.
//
// These are tested through the real provider rather than against
// sendingConfigPayload directly, because the defect was never in the rule — it
// was in the WIRING. A unit test on the helper would have passed against the
// broken code (see .plans/known-failures.md, "a unit test on a pure function
// proves the rule, not its application").
//
// Mutation coverage, verified by performing each mutation:
//  - removing `...sendingConfigPayload(campaignData)` from addCampaign's body
//    fails "posts the sending configuration the caller supplied";
//  - removing `...sendingConfigPayload(campaign)` from duplicateCampaign fails
//    "carries the original's pacing onto the copy";
//  - forwarding nulls instead of dropping them fails "omits absent fields
//    rather than sending null".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../services/apiClient', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true }),
}));

const showToast = vi.fn();
vi.mock('../context/NotificationContext', () => ({
  useNotification: () => ({ showToast }),
}));

import { CampaignProvider, useCampaigns } from '../context/CampaignContext';
import type { Campaign } from '../types';

/** The Setup step's output for a deliberately throttled campaign. */
const THROTTLED = {
  sendWindowStart: 540, // 09:00
  sendWindowEnd: 1080, // 18:00
  sendDays: 31, // Mon–Fri
  timezone: 'America/New_York',
  dailyLimit: 40,
  sendIntervalMinutes: 20,
  stopOnReply: true,
  stopOnClick: true,
  stopOnOpen: false,
  plainTextMode: true,
  followUpPercent: 70,
  openTracking: true,
  linkTracking: false,
};

const EXISTING: Campaign = {
  id: 'camp_1',
  name: 'Weekday Drip',
  createdAt: new Date('2026-07-01T10:00:00Z').toISOString(),
  status: 'ACTIVE',
  recipients: [],
  subject: 'Hello',
  body: 'Body',
  scheduledAt: new Date('2026-07-02T10:00:00Z').toISOString(),
  progress: 10,
  stats: { sent: 5, clicked: 1, replied: 0, opportunities: 0 },
  distributionMethod: 'INDIVIDUAL',
  autoFollowUps: [],
  ...THROTTLED,
};

/** Drives the context from inside the provider. */
const Harness: React.FC<{ onReady?: (api: ReturnType<typeof useCampaigns>) => void }> = () => {
  const api = useCampaigns();
  return (
    <div>
      <button onClick={() => void api.addCampaign({
        name: 'New Campaign',
        subject: 'Subject',
        body: 'Body',
        scheduledAt: new Date('2026-08-01T10:00:00Z').toISOString(),
        recipients: [{ name: 'Dana', email: 'dana@acme.test' }],
        distributionMethod: 'INDIVIDUAL',
        autoFollowUps: [],
        ...THROTTLED,
      })}>
        create
      </button>
      <button onClick={() => void api.addCampaign({
        name: 'Bare Campaign',
        subject: 'Subject',
        body: 'Body',
        scheduledAt: new Date('2026-08-01T10:00:00Z').toISOString(),
        recipients: [],
        distributionMethod: 'INDIVIDUAL',
        autoFollowUps: [],
      })}>
        create-bare
      </button>
      <button onClick={() => api.duplicateCampaign('camp_1')}>duplicate</button>
      <span data-testid="count">{api.campaigns.length}</span>
    </div>
  );
};

const renderHarness = async () => {
  render(
    <CampaignProvider>
      <Harness />
    </CampaignProvider>,
  );
  // Wait for the initial load so duplicateCampaign can find camp_1.
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
};

const postedBody = () => apiPost.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  showToast.mockReset();
  apiGet.mockResolvedValue({ campaigns: [EXISTING] });
  apiPost.mockResolvedValue({ campaign: { ...EXISTING, id: 'camp_2' } });
});

describe('CampaignContext — sending configuration', () => {
  it('posts the sending configuration the caller supplied', async () => {
    await renderHarness();
    await userEvent.click(screen.getByText('create'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(postedBody()).toMatchObject(THROTTLED);
  });

  it('carries the original\'s pacing onto the copy', async () => {
    await renderHarness();
    await userEvent.click(screen.getByText('duplicate'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body).toMatchObject(THROTTLED);
    expect(body.name).toBe('Copy of Weekday Drip');
    expect(body.status).toBe('DRAFT');
  });

  it('omits absent fields rather than sending null', async () => {
    // Every field on the create schema is `.optional()`, which accepts
    // undefined but REJECTS null — and these columns are null on any campaign
    // that never set them, so forwarding them verbatim would 400 on the most
    // common case rather than the rare one.
    apiGet.mockResolvedValue({
      campaigns: [{
        ...EXISTING,
        sendWindowStart: null, sendWindowEnd: null, sendDays: null,
        timezone: null, dailyLimit: null, sendIntervalMinutes: null,
      }],
    });
    await renderHarness();
    await userEvent.click(screen.getByText('duplicate'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = postedBody();
    for (const key of ['sendWindowStart', 'sendWindowEnd', 'sendDays', 'timezone', 'dailyLimit', 'sendIntervalMinutes']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('never posts half a send window', async () => {
    // isWithinSendWindow only applies a window when BOTH ends are set, and the
    // server rejects a one-sided one outright.
    apiGet.mockResolvedValue({
      campaigns: [{ ...EXISTING, sendWindowStart: 540, sendWindowEnd: null }],
    });
    await renderHarness();
    await userEvent.click(screen.getByText('duplicate'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body).not.toHaveProperty('sendWindowStart');
    expect(body).not.toHaveProperty('sendWindowEnd');
  });

  it('does not copy a legacy sendDays: 0 the server would now refuse', async () => {
    // 0 means "no day is ever a send day". It is no longer creatable, so a copy
    // cannot carry it; it degrades to no day restriction, and the copy is a
    // DRAFT that cannot send until deliberately activated.
    apiGet.mockResolvedValue({ campaigns: [{ ...EXISTING, sendDays: 0 }] });
    await renderHarness();
    await userEvent.click(screen.getByText('duplicate'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(postedBody()).not.toHaveProperty('sendDays');
  });

  it('sends no config keys at all when the caller supplied none', async () => {
    await renderHarness();
    await userEvent.click(screen.getByText('create-bare'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body.name).toBe('Bare Campaign');
    for (const key of Object.keys(THROTTLED)) {
      expect(body).not.toHaveProperty(key);
    }
  });
});
