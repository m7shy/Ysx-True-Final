import React, { useMemo, useState } from 'react';
import { Search, Shield, Send, Play, AlertTriangle } from 'lucide-react';
import { Lead, SequenceStage } from '../types';
import { renderTemplate } from '../utils';

/** Mirrors the `.max(5000)` on `recipients` in server/src/campaigns/routes.ts. */
const MAX_RECIPIENTS = 5000;

interface Step4Props {
  leads: Lead[];
  sequence: SequenceStage[];
  onRunSpamTest: () => void;
  onSendTestEmail: () => void;
  onStartCampaign: () => void;
  submitting?: boolean;
}

export const Step4Review: React.FC<Step4Props> = ({
  leads,
  sequence,
  onRunSpamTest,
  onSendTestEmail,
  onStartCampaign,
  submitting,
}) => {
  const [search, setSearch] = useState('');
  const [activeLeadIdx, setActiveLeadIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads.map((l, i) => ({ lead: l, index: i }));
    return leads
      .map((lead, index) => ({ lead, index }))
      .filter(({ lead }) =>
        lead.email.toLowerCase().includes(q) ||
        (lead.first_name ?? '').toLowerCase().includes(q) ||
        (lead.last_name ?? '').toLowerCase().includes(q)
      );
  }, [leads, search]);

  const activeLead = leads[activeLeadIdx];
  const activeStage = sequence[stageIdx];
  const activeVariant = activeStage?.variants[0];

  const renderedSubject =
    activeLead && activeVariant
      ? renderTemplate(activeVariant.subject, activeLead)
      : '';
  const renderedBody =
    activeLead && activeVariant
      ? renderTemplate(activeVariant.body, activeLead)
      : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 max-w-6xl mx-auto h-full">
      <aside className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0">
        <div className="p-3 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-volt-text transition-colors placeholder:text-neutral-500"
            />
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            {filtered.length} of {leads.length} lead{leads.length === 1 ? '' : 's'}
          </p>
          {leads.length > MAX_RECIPIENTS && (
            // The server caps `recipients` at 5000 per request, so submitting
            // this would 400 with a zod message after four steps of work.
            <div className="flex items-start gap-2 mt-2 text-xs text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {leads.length.toLocaleString()} leads exceeds the {MAX_RECIPIENTS.toLocaleString()} per-campaign
              limit — remove some, or split this into more than one campaign.
            </div>
          )}
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.map(({ lead, index }) => {
            const name =
              [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
              lead.email;
            const active = index === activeLeadIdx;
            return (
              <li key={`${lead.email}-${index}`}>
                <button
                  type="button"
                  onClick={() => setActiveLeadIdx(index)}
                  className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
                    active
                      ? 'bg-volt/10 border-volt-text'
                      : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <p className="text-sm font-medium text-white truncate">{name}</p>
                  <p className="text-xs text-neutral-500 truncate">{lead.email}</p>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-neutral-500">
              No matching leads.
            </li>
          )}
        </ul>
      </aside>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0">
        <header className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Preview</p>
            <p className="text-sm font-semibold text-white truncate">
              {activeLead?.email ?? '—'}
            </p>
          </div>
          <select
            value={stageIdx}
            onChange={(e) => setStageIdx(Number(e.target.value))}
            className="bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
          >
            {sequence.map((s, i) => (
              <option key={s.id} value={i}>
                Email {i + 1}
              </option>
            ))}
          </select>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {activeLead && activeVariant ? (
            <article className="max-w-2xl">
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                  Subject
                </p>
                <p className="text-base font-semibold text-white">
                  {renderedSubject}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                  Body
                </p>
                <pre className="whitespace-pre-wrap break-words text-sm text-neutral-300 font-sans leading-6">
                  {renderedBody}
                </pre>
              </div>
            </article>
          ) : (
            <p className="text-sm text-neutral-500">No lead selected.</p>
          )}
        </div>

        <footer className="p-4 border-t border-white/10 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onRunSpamTest}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/16 rounded-full transition-all"
          >
            <Shield className="w-4 h-4" />
            Run Spam Test
          </button>
          <button
            type="button"
            onClick={onSendTestEmail}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/16 rounded-full transition-all"
          >
            <Send className="w-4 h-4" />
            Send Test Email
          </button>
          <button
            type="button"
            onClick={onStartCampaign}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)] disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-all"
          >
            <Play className="w-4 h-4" />
            {submitting ? 'Starting…' : 'Start Campaign'}
          </button>
        </footer>
      </section>
    </div>
  );
};
