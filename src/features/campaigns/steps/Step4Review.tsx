import React, { useMemo, useState } from 'react';
import { Search, Shield, Send, Play } from 'lucide-react';
import { Lead, SequenceStage } from '../types';
import { renderTemplate } from '../utils';

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
      <aside className="rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col min-h-0">
        <div className="p-3 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {filtered.length} of {leads.length} lead{leads.length === 1 ? '' : 's'}
          </p>
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
                      ? 'bg-brand-500/10 border-brand-500'
                      : 'border-transparent hover:bg-slate-800/40'
                  }`}
                >
                  <p className="text-sm font-medium text-white truncate">{name}</p>
                  <p className="text-xs text-slate-500 truncate">{lead.email}</p>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              No matching leads.
            </li>
          )}
        </ul>
      </aside>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col min-h-0">
        <header className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Preview</p>
            <p className="text-sm font-semibold text-white truncate">
              {activeLead?.email ?? '—'}
            </p>
          </div>
          <select
            value={stageIdx}
            onChange={(e) => setStageIdx(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Subject
                </p>
                <p className="text-base font-semibold text-white">
                  {renderedSubject}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Body
                </p>
                <pre className="whitespace-pre-wrap break-words text-sm text-slate-200 font-sans leading-6">
                  {renderedBody}
                </pre>
              </div>
            </article>
          ) : (
            <p className="text-sm text-slate-500">No lead selected.</p>
          )}
        </div>

        <footer className="p-4 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onRunSpamTest}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg"
          >
            <Shield className="w-4 h-4" />
            Run Spam Test
          </button>
          <button
            type="button"
            onClick={onSendTestEmail}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg"
          >
            <Send className="w-4 h-4" />
            Send Test Email
          </button>
          <button
            type="button"
            onClick={onStartCampaign}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
          >
            <Play className="w-4 h-4" />
            {submitting ? 'Starting…' : 'Start Campaign'}
          </button>
        </footer>
      </section>
    </div>
  );
};
