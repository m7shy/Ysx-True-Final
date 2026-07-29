import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Landmark, ReceiptText } from 'lucide-react';
import { Card, Badge, Spinner, Alert, EmptyState, Eyebrow, Table, THead, TBody, TR, TH, TD } from '@/src/design/ui';
import { blurIn } from '@/src/design/motion';
import { useRouter } from '../router';
import {
  fetchInvoices,
  fetchInvoice,
  formatMoney,
  formatDate,
  type Invoice,
  type PaymentInstructions,
  type InvoiceStatus,
} from '../services/portalApi';

type StatusBadge = { variant: 'neutral' | 'volt' | 'success' | 'warning' | 'danger'; label: string };

const STATUS_BADGE: Record<InvoiceStatus, StatusBadge> = {
  SENT: { variant: 'volt', label: 'Awaiting payment' },
  VIEWED: { variant: 'volt', label: 'Awaiting payment' },
  OVERDUE: { variant: 'danger', label: 'Overdue' },
  PAID: { variant: 'success', label: 'Paid' },
  CANCELLED: { variant: 'neutral', label: 'Cancelled' },
};

/**
 * Never index STATUS_BADGE directly. It is exhaustive over the CLIENT's
 * InvoiceStatus union, which is an assertion about the server rather than a
 * derivation from it — adding a status to the Prisma enum leaves this map
 * "exhaustive" as far as tsc is concerned while the lookup returns undefined,
 * and the next line reads `.variant` off it. That exact shape white-screened
 * ScraperView on 2026-07-29 (STATUS_META['cancelling']) and the portal shell
 * the day before. The portal routes currently filter DRAFT and CANCELLED out,
 * so this is defence against a future widening, not a live bug.
 */
function statusBadge(status: InvoiceStatus): StatusBadge {
  return STATUS_BADGE[status] ?? { variant: 'neutral', label: String(status) };
}

export const InvoicesPage: React.FC<{ id?: string }> = ({ id }) => {
  return id ? <InvoiceDetail id={id} /> : <InvoiceList />;
};

const InvoiceList: React.FC = () => {
  const { navigate } = useRouter();
  const [data, setData] = React.useState<{ invoices: Invoice[]; outstandingCents: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchInvoices().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data)
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-volt-text" />
      </div>
    );

  const currency = data.invoices[0]?.currency ?? 'usd';

  return (
    <motion.div variants={blurIn} initial="hidden" animate="show">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Invoices</h1>
          <p className="mt-1 text-sm text-neutral-400">Everything billed, and exactly where it stands.</p>
        </div>
        <Card padding="sm" className="px-5 py-3">
          <Eyebrow>Outstanding balance</Eyebrow>
          <p className={`mt-1 text-xl font-semibold ${data.outstandingCents > 0 ? 'text-white' : 'text-green-400'}`}>
            {formatMoney(data.outstandingCents, currency)}
          </p>
        </Card>
      </div>

      {data.invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-6 w-6" />}
          title="No invoices yet"
          hint="When an invoice is issued, it appears here with its due date and payment details."
        />
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Project</TH>
                <TH>Amount</TH>
                <TH>Due</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {data.invoices.map((inv) => {
                const badge = statusBadge(inv.status);
                return (
                  <TR
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    <TD className="font-medium text-white">{inv.number}</TD>
                    <TD className="text-neutral-400">{inv.project?.name ?? '—'}</TD>
                    <TD className="text-white">{formatMoney(inv.amountCents, inv.currency)}</TD>
                    <TD className="text-neutral-400">{formatDate(inv.dueAt)}</TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </motion.div>
  );
};

const InvoiceDetail: React.FC<{ id: string }> = ({ id }) => {
  const { navigate } = useRouter();
  const [data, setData] = React.useState<{ invoice: Invoice; paymentInstructions: PaymentInstructions } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchInvoice(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data)
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-volt-text" />
      </div>
    );

  const { invoice, paymentInstructions } = data;
  const badge = statusBadge(invoice.status);
  const receipt = invoice.payments.find((p) => p.receipt)?.receipt ?? null;

  return (
    <motion.div variants={blurIn} initial="hidden" animate="show" className="mx-auto max-w-2xl">
      <button
        onClick={() => navigate('/invoices')}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All invoices
      </button>

      <Card padding="lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Invoice</Eyebrow>
            <h1 className="mt-1 text-xl font-semibold text-white">{invoice.number}</h1>
            {invoice.project && <p className="mt-1 text-sm text-neutral-500">{invoice.project.name}</p>}
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-neutral-500">Amount</p>
            <p className="mt-0.5 text-2xl font-semibold text-white">
              {formatMoney(invoice.amountCents, invoice.currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500">Due date</p>
            <p className="mt-0.5 text-sm text-white">{formatDate(invoice.dueAt)}</p>
          </div>
        </div>

        {invoice.lineItemsJson && invoice.lineItemsJson.length > 0 && (
          <div className="mb-6 divide-y divide-white/[0.06] rounded-xl border border-white/10">
            {invoice.lineItemsJson.map((li, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-neutral-300">{li.label}</span>
                <span className="text-white">{formatMoney(li.amountCents, invoice.currency)}</span>
              </div>
            ))}
          </div>
        )}

        {invoice.notes && <p className="mb-6 text-sm text-neutral-400">{invoice.notes}</p>}

        {invoice.status === 'PAID' ? (
          <Alert variant="success" title="Paid — thank you">
            {receipt
              ? `Receipt ${receipt.number} · ${formatDate(invoice.paidAt)}`
              : `Received ${formatDate(invoice.paidAt)}`}
          </Alert>
        ) : invoice.status === 'CANCELLED' ? (
          <Alert variant="info">This invoice was cancelled — nothing to pay.</Alert>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-volt-text" />
              <h2 className="text-sm font-semibold text-white">{paymentInstructions.title}</h2>
            </div>
            <ul className="space-y-1 text-sm text-neutral-400">
              {paymentInstructions.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-neutral-600">
              Once your transfer arrives we mark it paid and your receipt appears here automatically.
            </p>
          </div>
        )}
      </Card>
    </motion.div>
  );
};
