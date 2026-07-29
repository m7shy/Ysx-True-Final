// FILE: test/campaignWizardSendDays.test.tsx
//
// A campaign must not be able to leave the wizard with no sending days.
//
// The seven day chips on step 3 are converted to a bitmask
// (scheduleToSendDaysBitmask), and un-ticking all of them yields 0. The send
// engine reads 0 as "no day is ever a send day"
// (`sendDays != null && (sendDays & dayBit) === 0` — false every day), so the
// campaign sits ACTIVE forever having sent nothing: no pausedReason, no error,
// no banner, because the worker never selects it at all. Nothing in the UI or
// the API said no.
//
// Mutation coverage, verified by performing the mutation: dropping the
// `DAY_KEYS.some(...)` clause from CampaignWizard's `canAdvance(3)` fails
// "keeps Next disabled while no day is selected".
//
// The server refuses sendDays: 0 as well (campaigns/routes.ts
// rejectEmptySendDays, covered in server/src/__tests__/campaignRoutes.test.ts).
// This test covers the half that stops the user hitting that 400 only after
// filling in four steps.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const addCampaign = vi.fn();
vi.mock('../context/CampaignContext', () => ({
  useCampaigns: () => ({ addCampaign }),
}));

import { CampaignWizard } from '../src/features/campaigns/CampaignWizard';

// Seeding a lead satisfies step 1 (leads.length > 0 and emailMapped), and the
// default sequence has a body on every stage, so step 2 passes untouched —
// two clicks reach step 3 without exercising CSV import.
const INITIAL_LEAD = { email: 'dana@acme.test', name: 'Dana Vale', company: 'Acme' };

// Mon–Fri are on by DEFAULT_SCHEDULE; Sat/Sun are off.
const DEFAULT_ON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

async function gotoStep3(user: ReturnType<typeof userEvent.setup>, onClose = vi.fn()) {
  render(<CampaignWizard initialLead={INITIAL_LEAD} onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: /next/i }));
  await user.click(screen.getByRole('button', { name: /next/i }));
  // Step 3 is on screen once its schedule section is.
  await screen.findByText(/Schedule Configuration/i);
  return onClose;
}

beforeEach(() => {
  addCampaign.mockReset();
  addCampaign.mockResolvedValue(undefined);
});

describe('CampaignWizard — active days', () => {
  it('keeps Next enabled with the default Mon–Fri schedule', async () => {
    const user = userEvent.setup();
    await gotoStep3(user);

    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    expect(screen.queryByText(/never sends anything/i)).not.toBeInTheDocument();
  });

  it('keeps Next disabled while no day is selected', async () => {
    const user = userEvent.setup();
    await gotoStep3(user);

    for (const day of DEFAULT_ON) {
      await user.click(screen.getByRole('button', { name: day }));
    }

    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('warns in place when no day is selected', async () => {
    const user = userEvent.setup();
    await gotoStep3(user);

    for (const day of DEFAULT_ON) {
      await user.click(screen.getByRole('button', { name: day }));
    }

    expect(screen.getByText(/never sends anything/i)).toBeInTheDocument();
  });

  it('recovers as soon as one day is re-selected', async () => {
    const user = userEvent.setup();
    await gotoStep3(user);

    for (const day of DEFAULT_ON) {
      await user.click(screen.getByRole('button', { name: day }));
    }
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Sat' }));

    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    expect(screen.queryByText(/never sends anything/i)).not.toBeInTheDocument();
  });
});

// The wizard holds imported leads, the sequence and every setting in component
// state with no persistence of any kind, so Close discarded all of it silently
// — after a 5,000-row import, one misclick and it was gone with no undo.
//
// Mutation coverage, verified by performing the mutation: pointing the header
// Close button back at `onClose` directly fails "asks before discarding
// imported work".
describe('CampaignWizard — closing with work in progress', () => {
  it('asks before discarding imported work', async () => {
    const user = userEvent.setup();
    // initialLead alone counts as work: it is a lead the user picked.
    const onClose = await gotoStep3(user);

    await user.click(screen.getByRole('button', { name: /^close$/i }));

    expect(screen.getByText(/Discard this campaign\?/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the wizard open when the discard is declined', async () => {
    const user = userEvent.setup();
    const onClose = await gotoStep3(user);

    await user.click(screen.getByRole('button', { name: /^close$/i }));
    await user.click(screen.getByRole('button', { name: /keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Schedule Configuration/i)).toBeInTheDocument();
  });

  it('closes once the discard is confirmed', async () => {
    const user = userEvent.setup();
    const onClose = await gotoStep3(user);

    await user.click(screen.getByRole('button', { name: /^close$/i }));
    await user.click(screen.getByRole('button', { name: /^discard$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when there is nothing to lose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // No initialLead, nothing touched — an untouched wizard must not nag.
    render(<CampaignWizard onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /^close$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Discard this campaign\?/i)).not.toBeInTheDocument();
  });
});
