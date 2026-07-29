// FILE: test/clientPortalInvoices.test.tsx
//
// The invoice Send button must fire exactly once per click-burst, and must not
// block a different invoice from being sent at the same time.
//
// POST /api/invoices/:id/send accepts a DRAFT *or* an already-SENT invoice
// (deliberate — re-sending is a legitimate dunning action) and emails every
// portal user of that client on each accepted call. The button had no in-flight
// state and stayed enabled until the follow-up load() returned, so a
// double-click on a slow connection delivered the same invoice email twice.
// Reported 2026-07-25, again 2026-07-28, fixed 2026-07-29.
//
// Mutation coverage, verified by actually performing each mutation:
//  - reverting the handler to the original
//    `onClick={() => sendInvoice(inv.id).then(load).catch(...)}` one-liner
//    (no in-flight state at all) fails "sends once when double-clicked";
//  - narrowing the per-invoice guard to a single "a send is running" flag
//    fails "sends two different invoices concurrently".
// Note what these tests do NOT prove: `fireEvent` wraps each click in `act()`,
// so React commits between them and the `disabled` attribute alone would also
// stop the second click. The synchronous ref guard is belt-and-braces for the
// case where two handlers run before a commit; no DOM-level test can
// distinguish it, and that is stated here rather than asserted falsely.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchAdminInvoices = vi.fn();
const fetchAdminClients = vi.fn();
const fetchAdminProjects = vi.fn();
const sendInvoice = vi.fn();
const markInvoicePaid = vi.fn();

vi.mock('../services/portalAdminApi', () => ({
  STAGES: ['ONBOARDING', 'EDITING', 'REVISION', 'FINAL_DELIVERY', 'COMPLETE'],
  fetchAdminClients: (...a: unknown[]) => fetchAdminClients(...a),
  createClient: vi.fn(),
  inviteClientUser: vi.fn(),
  fetchAdminProjects: (...a: unknown[]) => fetchAdminProjects(...a),
  fetchAdminProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  addFileLink: vi.fn(),
  deleteFileLink: vi.fn(),
  updateRevision: vi.fn(),
  postAdminMessage: vi.fn(),
  fetchAdminInvoices: (...a: unknown[]) => fetchAdminInvoices(...a),
  createInvoice: vi.fn(),
  sendInvoice: (...a: unknown[]) => sendInvoice(...a),
  markInvoicePaid: (...a: unknown[]) => markInvoicePaid(...a),
}));

import ClientPortalView from '../components/ClientPortalView';

const draft = (id: string, number: string) => ({
  id,
  clientId: 'cl_1',
  number,
  status: 'DRAFT' as const,
  amountCents: 125_000,
  currency: 'usd',
  dueAt: null,
  paidAt: null,
  notes: null,
  client: { id: 'cl_1', name: 'Acme Films', companyName: null },
});

beforeEach(() => {
  fetchAdminInvoices.mockReset();
  fetchAdminClients.mockReset();
  fetchAdminProjects.mockReset();
  sendInvoice.mockReset();
  markInvoicePaid.mockReset();

  fetchAdminInvoices.mockResolvedValue({ invoices: [draft('inv_1', 'INV-0007')] });
  fetchAdminClients.mockResolvedValue({ clients: [] });
  fetchAdminProjects.mockResolvedValue({ projects: [] });
  sendInvoice.mockResolvedValue({ invoice: { ...draft('inv_1', 'INV-0007'), status: 'SENT' } });
});

/** Render and switch to the Invoices tab; resolves once a Send button exists. */
async function openInvoicesTab() {
  render(<ClientPortalView />);
  await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));
  await screen.findAllByRole('button', { name: /^send$/i });
}

const sendButtons = () => screen.getAllByRole('button', { name: /^send$/i });

describe('ClientPortalView — invoice Send', () => {
  it('sends once when the button is double-clicked', async () => {
    // Never resolves: the window under test is the one where the request is
    // still in flight.
    sendInvoice.mockImplementation(() => new Promise(() => {}));

    await openInvoicesTab();
    const send = sendButtons()[0];

    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(1));
    expect(sendInvoice).toHaveBeenCalledWith('inv_1');
  });

  it('sends two different invoices concurrently', async () => {
    // The guard is per-invoice. A single in-flight flag would make this second
    // click a silent no-op — a legitimate action that does nothing is the same
    // class of defect as the double-send it replaced.
    fetchAdminInvoices.mockResolvedValue({
      invoices: [draft('inv_1', 'INV-0007'), draft('inv_2', 'INV-0008')],
    });
    sendInvoice.mockImplementation(() => new Promise(() => {}));

    await openInvoicesTab();
    await waitFor(() => expect(sendButtons()).toHaveLength(2));
    const [first, second] = sendButtons();

    fireEvent.click(first);
    fireEvent.click(second);

    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(2));
    expect(sendInvoice).toHaveBeenNthCalledWith(1, 'inv_1');
    expect(sendInvoice).toHaveBeenNthCalledWith(2, 'inv_2');
  });

  it('disables the button while the send is in flight', async () => {
    sendInvoice.mockImplementation(() => new Promise(() => {}));

    await openInvoicesTab();
    const send = sendButtons()[0];
    fireEvent.click(send);

    // Assert on the captured node: while loading, Button renders a Spinner
    // whose aria-label pushes the accessible name to "Loading Send", so a
    // re-query by name would miss it. React reuses the same DOM node.
    await waitFor(() => expect(send).toBeDisabled());
    expect(send).toHaveAttribute('aria-busy', 'true');
  });

  it('re-enables and surfaces the error when the send fails', async () => {
    sendInvoice.mockRejectedValue(new Error('Mailbox rejected the message'));

    await openInvoicesTab();
    fireEvent.click(sendButtons()[0]);

    await waitFor(() => expect(screen.getByText(/Mailbox rejected the message/i)).toBeInTheDocument());
    // A failed send must leave the operator able to retry.
    expect(sendButtons()[0]).not.toBeDisabled();
  });

  it('allows a deliberate second send after the first completes', async () => {
    await openInvoicesTab();

    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(1));
    // The row is still DRAFT in the refetch mock, so the button is still there.
    await waitFor(() => expect(sendButtons()[0]).not.toBeDisabled());

    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(2));
  });
});
