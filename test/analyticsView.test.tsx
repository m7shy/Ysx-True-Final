// FILE: test/analyticsView.test.tsx
//
// The Analytics screen must show the tenant's real numbers and nothing else.
//
// It previously rendered services/mockZoho's fixture regardless of real data,
// while services/analyticsApi.ts — a working client for a mounted, real endpoint
// — was imported by nothing. Alongside the mock funnel it displayed a "Sent
// Emails" figure of `dmsSent + 142`, a hardcoded 42.8% open rate, invented
// "vs last period" deltas, a twelve-bar chart of literal constants, and five
// fictional template names.
//
// These tests exist to make that class of thing fail loudly rather than look
// plausible.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getFunnelMetrics = vi.fn();
vi.mock('../services/analyticsApi', () => ({
  getFunnelMetrics: (...args: unknown[]) => getFunnelMetrics(...args),
}));

import { AnalyticsView } from '../components/AnalyticsView';

const METRICS = {
  dmsSent: 50, replies: 10, callsBooked: 4, trials: 2, clients: 1,
  sent: 40, opened: 20, clicked: 5, bounced: 1,
};

beforeEach(() => {
  getFunnelMetrics.mockReset();
  getFunnelMetrics.mockResolvedValue(METRICS);
});

describe('AnalyticsView', () => {
  it('renders figures derived from the API, not padded constants', async () => {
    render(<AnalyticsView />);

    // "Emails Sent" must be exactly `sent`. It used to be dmsSent + 142, which
    // for this fixture would render 192. `40` legitimately appears more than
    // once (the stat card and the engagement breakdown), so assert on presence
    // rather than uniqueness — the load-bearing assertion is the absence of 192.
    await waitFor(() => expect(screen.getAllByText('40').length).toBeGreaterThan(0));
    expect(screen.queryByText('192')).not.toBeInTheDocument();

    // Open rate is opened/sent = 50.0%, not the hardcoded 42.8%.
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.queryByText('42.8%')).not.toBeInTheDocument();
  });

  it('shows no invented period-over-period deltas', async () => {
    render(<AnalyticsView />);
    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalled());

    expect(screen.queryByText(/vs last period/i)).not.toBeInTheDocument();
  });

  it('shows no fabricated template names', async () => {
    render(<AnalyticsView />);
    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalled());

    expect(screen.queryByText(/Q3 Partnership Proposal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Top Templates/i)).not.toBeInTheDocument();
  });

  it('requests the selected period and refetches when it changes', async () => {
    // The selector was previously a defaultValue with no handler, so changing it
    // silently did nothing.
    render(<AnalyticsView />);
    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalledWith(30));

    await userEvent.selectOptions(screen.getByRole('combobox'), '7');

    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalledWith(7));
  });

  it('asks for all-time with no window when "All time" is chosen', async () => {
    render(<AnalyticsView />);
    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByRole('combobox'), 'all');

    await waitFor(() => expect(getFunnelMetrics).toHaveBeenCalledWith(undefined));
  });

  it('says the data could not be loaded instead of showing zeroes', async () => {
    // A failed request used to log to the console and leave the zeroed initial
    // state on screen — indistinguishable from a genuinely empty account, so an
    // outage read as "you have no leads".
    getFunnelMetrics.mockRejectedValue(new Error('Network unreachable'));

    render(<AnalyticsView />);

    await waitFor(() => expect(screen.getByText(/Analytics unavailable/i)).toBeInTheDocument());
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('withholds the projection until there is enough volume to mean anything', async () => {
    getFunnelMetrics.mockResolvedValue({ ...METRICS, dmsSent: 3, clients: 1 });

    render(<AnalyticsView />);

    await waitFor(() => expect(screen.getByText(/Not enough volume yet/i)).toBeInTheDocument());
    // 1 client from 3 leads would otherwise project a triumphant "100 leads ≈ 33 clients".
    expect(screen.queryByText(/≈ 33 clients/)).not.toBeInTheDocument();
  });

  it('shows a dash rather than 0% when there is no denominator', async () => {
    getFunnelMetrics.mockResolvedValue({
      dmsSent: 0, replies: 0, callsBooked: 0, trials: 0, clients: 0,
      sent: 0, opened: 0, clicked: 0, bounced: 0,
    });

    render(<AnalyticsView />);

    // "0.0%" asserts a measured rate of zero; a brand-new account has not
    // measured anything.
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });
});
