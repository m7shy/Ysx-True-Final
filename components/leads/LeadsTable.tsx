import React from 'react';
import { motion } from 'motion/react';
import { Search, Mail, Trash2, Loader2, Zap, Radar, Ghost } from 'lucide-react';
import { Lead, LeadStatus } from '../../types';
import { EASE, staggerDelay, MaskedReveal } from '../motion/primitives';

const STATUS_OPTIONS = (
  <>
    <option value="NEW">New</option>
    <option value="CONTACTED">Contacted</option>
    <option value="REPLIED">Replied</option>
    <option value="INTERESTED">Interested</option>
    <option value="CALL_BOOKED">Call Booked</option>
    <option value="TRIAL">Trial</option>
    <option value="CLIENT_CLOSED">Client Closed</option>
    <option value="LOST">Not Interested / Lost</option>
    <option value="DNC">Do Not Contact</option>
  </>
);

const StatusBadge = ({ status }: { status: LeadStatus }) => {
  const styles: Record<string, string> = {
    'NEW': 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    'CONTACTED': 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    'REPLIED': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
    'INTERESTED': 'bg-green-500/15 text-green-300 border-green-500/25',
    'CALL_BOOKED': 'bg-purple-500/15 text-purple-300 border-purple-500/25',
    'TRIAL': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
    'CLIENT_CLOSED': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    'LOST': 'bg-white/[0.06] text-neutral-300 border-white/10',
    'DNC': 'bg-red-500/20 text-red-200 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status] || 'bg-white/[0.06] text-neutral-300 border-white/10'}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

const scoreBadgeClass = (score: number) =>
  score >= 80 ? 'bg-green-500/15 text-green-400 border-green-500/25' :
  score >= 50 ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' :
  'bg-red-500/15 text-red-400 border-red-500/25';

export interface LeadsTableProps {
  leads: Lead[];
  loading: boolean;
  analyzingIds: Set<string>;
  actionLoading: string | null;
  onAnalyze: (id: string) => void;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onScan: (lead: Lead) => void;
  onCompose: (lead: Lead) => void;
  onDelete: (id: string) => void;
}

export const LeadsTable: React.FC<LeadsTableProps> = ({
  leads,
  loading,
  analyzingIds,
  actionLoading,
  onAnalyze,
  onStatusChange,
  onScan,
  onCompose,
  onDelete,
}) => {
  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
            <Loader2 className="w-6 h-6 animate-spin mb-2" />
            <p>Loading leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="w-16 h-16 bg-white/[0.03] border border-white/10 rounded-2xl flex items-center justify-center mb-4">
              <Ghost className="w-8 h-8 text-neutral-500" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">No Leads Found</h3>
            <p className="text-neutral-400 text-sm">
              Try adjusting your search, add a lead, or run the scraper to fill your pipeline.
            </p>
          </div>
        ) : (
          leads.map((lead, index) => (
            <motion.div
              key={lead.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: staggerDelay(index) }}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-white">{lead.name}</h3>
                  <div className="text-xs text-neutral-400">{lead.company}</div>
                </div>
                <StatusBadge status={lead.status} />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">Score</p>
                  {lead.score !== undefined ? (
                    <div className="flex items-center">
                      <span className={`inline-flex items-center justify-center border px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadgeClass(lead.score)}`}>
                        {lead.score}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => onAnalyze(lead.id)}
                      disabled={analyzingIds.has(lead.id)}
                      className="text-xs font-medium text-volt-text hover:underline flex items-center disabled:opacity-50"
                    >
                      {analyzingIds.has(lead.id) ? 'Analyzing...' : 'Run AI Scan'}
                    </button>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">Last Contact</p>
                  <p className="text-sm text-neutral-300">{lead.lastContacted ? new Date(lead.lastContacted).toLocaleDateString() : '-'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-white/10">
                <div className="flex space-x-1">
                  <button onClick={() => onScan(lead)} aria-label={`Scan fit for ${lead.name}`} className="p-2 text-neutral-400 hover:text-volt-text bg-white/[0.03] rounded-full transition-colors duration-300" title="Scan Fit">
                    <Radar className="w-4 h-4" />
                  </button>
                  <button onClick={() => onCompose(lead)} aria-label={`Email ${lead.name}`} className="p-2 text-neutral-400 hover:text-volt-text bg-white/[0.03] rounded-full transition-colors duration-300" title="Email">
                    <Mail className="w-4 h-4" />
                  </button>
                  <button onClick={() => onDelete(lead.id)} disabled={actionLoading === lead.id} aria-label={`Delete ${lead.name}`} className="p-2 text-neutral-400 hover:text-red-400 bg-white/[0.03] rounded-full transition-colors duration-300">
                    {actionLoading === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>

                <select
                  value={lead.status}
                  onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
                  aria-label={`Status for ${lead.name}`}
                  className="text-xs bg-white/[0.03] border border-white/10 rounded-full py-1.5 pl-2 pr-6 focus:outline-none focus:border-volt-text font-medium text-neutral-300"
                >
                  {STATUS_OPTIONS}
                </select>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <MaskedReveal className="hidden md:flex rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden flex-1 flex-col min-h-[400px]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-neutral-500 uppercase text-xs font-semibold border-b border-white/10">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Score</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Contact</th>
                <th className="px-6 py-4">Source</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                    <div className="flex justify-center items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" /> Loading leads...
                    </div>
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-24 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-20 h-20 bg-white/[0.03] rounded-2xl flex items-center justify-center mb-4 border border-white/10">
                        <Search className="w-10 h-10 text-neutral-600" />
                      </div>
                      <h3 className="text-xl font-semibold text-neutral-200 mb-2">No Leads Found</h3>
                      <p className="text-neutral-400 text-sm max-w-xs leading-relaxed">
                        We couldn't find any leads matching your criteria. Try a different search, import a CSV, or run the scraper.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="group hover:bg-white/[0.03] transition-colors duration-300">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white">{lead.name}</div>
                      <div className="text-xs text-neutral-400">{lead.email}</div>
                      {lead.company && <div className="text-xs text-neutral-500 mt-0.5">{lead.company}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {lead.score !== undefined ? (
                        <div className="flex items-center">
                          <span className={`inline-flex items-center justify-center border px-2.5 py-0.5 rounded-full text-xs font-semibold ${scoreBadgeClass(lead.score)}`}>
                            {lead.score}
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={() => onAnalyze(lead.id)}
                          disabled={analyzingIds.has(lead.id)}
                          className="text-xs font-medium text-volt-text hover:bg-volt/10 px-2 py-1 rounded-full transition-colors duration-300 flex items-center disabled:opacity-50"
                        >
                          {analyzingIds.has(lead.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
                          Analyze
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={lead.status}
                        onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
                        disabled={actionLoading === lead.id}
                        aria-label={`Status for ${lead.name}`}
                        className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide border border-white/10 bg-white/[0.03] text-neutral-300 outline-none cursor-pointer transition-colors duration-300 hover:bg-white/[0.06] focus:border-volt-text"
                      >
                        {STATUS_OPTIONS}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-neutral-400 tabular-nums">
                      {lead.lastContacted ? new Date(lead.lastContacted).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-neutral-400">
                      {lead.source}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => onScan(lead)}
                          aria-label={`Scan fit for ${lead.name}`}
                          className="p-1.5 text-neutral-400 hover:text-volt-text hover:bg-volt/10 rounded-full transition-colors duration-300"
                          title="Scan Fit"
                        >
                          <Radar className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onCompose(lead)}
                          aria-label={`Email ${lead.name}`}
                          className="p-1.5 text-neutral-400 hover:text-volt-text hover:bg-volt/10 rounded-full transition-colors duration-300"
                          title="Email Lead"
                        >
                          <Mail className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDelete(lead.id)}
                          disabled={actionLoading === lead.id}
                          aria-label={`Delete ${lead.name}`}
                          className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors duration-300"
                          title="Delete Lead"
                        >
                          {actionLoading === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </MaskedReveal>
    </>
  );
};
