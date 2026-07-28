import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, TrendingUp, Mail, MousePointerClick, Reply, Target, Phone, Zap, Briefcase, AlertTriangle, MailWarning } from 'lucide-react';
import { getFunnelMetrics, type FunnelMetrics } from '../services/analyticsApi';
import { Card, Select } from '../src/design/ui';

/**
 * Campaign analytics, backed entirely by GET /api/analytics/summary.
 *
 * This screen used to render `services/mockZoho`'s fixture regardless of the
 * tenant's real data, while `services/analyticsApi.ts` — a working client for a
 * mounted, real endpoint — was imported by nothing. Alongside the mock funnel it
 * showed a "Sent Emails" figure of `dmsSent + 142`, a hardcoded 42.8% open rate,
 * invented period-over-period deltas, a twelve-bar chart of literal constants,
 * and five fictional template names with fictional rates.
 *
 * Two rules hold here now:
 *
 * 1. Every number comes from the API. Nothing is padded, invented or assumed.
 * 2. Anything the API cannot answer is NOT displayed. Period-over-period deltas
 *    and per-template performance have no endpoint behind them, so they are gone
 *    rather than faked. A metric that looks precise and is not is worse than an
 *    absent one — it gets believed, and then acted on.
 */

const EMPTY: FunnelMetrics = {
  dmsSent: 0, replies: 0, callsBooked: 0, trials: 0, clients: 0,
  sent: 0, opened: 0, clicked: 0, bounced: 0,
};

const PERIODS = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: 'all', label: 'All time' },
];

/** Percentage of `whole`, or null when there is no denominator to divide by. */
function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return (part / whole) * 100;
}

/** Renders a rate, or an em dash — never 0% for "we cannot know yet". */
const Pct: React.FC<{ value: number | null; digits?: number }> = ({ value, digits = 1 }) =>
  value === null ? <span className="text-neutral-600">—</span> : <>{value.toFixed(digits)}%</>;

export const AnalyticsView: React.FC = () => {
  const [funnel, setFunnel] = useState<FunnelMetrics>(EMPTY);
  const [period, setPeriod] = useState('30');
  const [loading, setLoading] = useState(true);
  // Distinct from "all zeroes". A failed request used to log to the console and
  // leave the zeroed initial state on screen, which is indistinguishable from a
  // genuinely empty account — so an outage looked like "you have no leads".
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(async (days: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFunnelMetrics(days === 'all' ? undefined : Number(days));
      if (isMounted.current) setFunnel(data);
    } catch (err: any) {
      if (isMounted.current) {
        setError(err?.message ?? 'Could not load analytics.');
        setFunnel(EMPTY);
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void load(period);
    return () => {
      isMounted.current = false;
    };
  }, [load, period]);

  const replyRate = rate(funnel.replies, funnel.dmsSent);
  const callRate = rate(funnel.callsBooked, funnel.replies);
  const closeRate = rate(funnel.clients, funnel.callsBooked);
  const openRate = rate(funnel.opened, funnel.sent);
  const clickRate = rate(funnel.clicked, funnel.sent);
  const bounceRate = rate(funnel.bounced, funnel.sent);
  const conversionRate = rate(funnel.clients, funnel.dmsSent);

  // Only stated once there is enough volume for the ratio to mean anything.
  // Projecting "100 leads ≈ N clients" off three sends is noise dressed as insight.
  const PROJECTION_MIN_SENT = 20;
  const projection100 =
    funnel.dmsSent >= PROJECTION_MIN_SENT ? Math.round((funnel.clients / funnel.dmsSent) * 100) : null;

  // Real engagement breakdown, replacing a bar chart of hardcoded heights. These
  // are counts actually held; bar widths are relative to the largest.
  const engagement = [
    { label: 'Sent', value: funnel.sent, className: 'bg-blue-400' },
    { label: 'Opened', value: funnel.opened, className: 'bg-purple-400' },
    { label: 'Clicked', value: funnel.clicked, className: 'bg-volt' },
    { label: 'Replied', value: funnel.replies, className: 'bg-emerald-400' },
    { label: 'Bounced', value: funnel.bounced, className: 'bg-red-400' },
  ];
  const engagementMax = Math.max(...engagement.map((e) => e.value), 1);
  const hasEngagement = engagement.some((e) => e.value > 0);

  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? 'the selected period';

  return (
    <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white flex items-center">
            <BarChart3 className="w-6 h-6 mr-2 text-volt-text" />
            Campaign Analytics
          </h2>
          <p className="text-neutral-400 mt-1">
            {loading ? 'Loading…' : `Performance metrics for ${periodLabel}.`}
          </p>
        </div>
        {/* Controlled, and it refetches. This was a `defaultValue` with no handler,
            so changing the period silently did nothing at all. */}
        <Select
          className="w-full md:w-auto"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          disabled={loading}
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </div>

      {error && (
        <Card padding="md" className="mb-8 border-red-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-white font-semibold mb-1">Analytics unavailable</h4>
              <p className="text-neutral-400 text-sm">
                {error} These figures are not zero — they could not be loaded.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Engine Performance Section */}
      <Card padding="md" className="mb-8 p-4 md:p-6">
        <h3 className="text-lg font-semibold text-white mb-6 flex items-center">
          <Target className="w-5 h-5 mr-2 text-volt-text" />
          Engine Performance
        </h3>

        <div className="relative mb-8">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/10 -translate-y-1/2 hidden md:block z-0" />
          <div className="absolute left-1/2 top-0 w-0.5 h-full bg-white/10 -translate-x-1/2 md:hidden z-0" />

          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 md:gap-4 relative z-10">
             <div className="flex flex-col items-center bg-noir py-2">
                <div className="w-14 h-14 rounded-full bg-white/[0.05] border-4 border-noir flex items-center justify-center mb-2">
                   <Mail className="w-6 h-6 text-neutral-400" />
                </div>
                <div className="text-2xl font-semibold text-white">{funnel.dmsSent}</div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Leads Contacted</div>
             </div>

             <div className="flex flex-col items-center bg-noir py-2">
                <div className="w-14 h-14 rounded-full bg-volt/10 border-4 border-noir flex items-center justify-center mb-2 relative">
                   <Reply className="w-6 h-6 text-volt-text" />
                   <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-xs font-medium text-volt-text bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/10 hidden lg:block">
                     <Pct value={replyRate} />
                   </div>
                </div>
                <div className="text-2xl font-semibold text-volt-text">{funnel.replies}</div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Replies</div>
             </div>

             <div className="flex flex-col items-center bg-noir py-2">
                <div className="w-14 h-14 rounded-full bg-purple-500/10 border-4 border-noir flex items-center justify-center mb-2 relative">
                   <Phone className="w-6 h-6 text-purple-400" />
                   <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-xs font-medium text-purple-300 bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/10 hidden lg:block">
                     <Pct value={callRate} />
                   </div>
                </div>
                <div className="text-2xl font-semibold text-purple-400">{funnel.callsBooked}</div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Calls Booked</div>
             </div>

             <div className="flex flex-col items-center bg-noir py-2">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 border-4 border-noir flex items-center justify-center mb-2">
                   <Zap className="w-6 h-6 text-amber-400" />
                </div>
                <div className="text-2xl font-semibold text-amber-400">{funnel.trials}</div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Trials</div>
             </div>

             <div className="flex flex-col items-center bg-noir py-2">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border-4 border-noir flex items-center justify-center mb-2 relative">
                   <Briefcase className="w-6 h-6 text-emerald-400" />
                   <div className="absolute -left-8 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-300 bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/10 hidden lg:block">
                     <Pct value={closeRate} />
                   </div>
                </div>
                <div className="text-2xl font-semibold text-emerald-400">{funnel.clients}</div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Clients Closed</div>
             </div>
          </div>
        </div>

        <div className="bg-white/[0.03] rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center border border-white/10">
          <div className="p-2 bg-volt rounded-xl mb-3 md:mb-0 md:mr-4 flex-shrink-0 shadow-glow">
             <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h4 className="text-white font-semibold text-lg mb-1">The Truth</h4>
            <p className="text-neutral-300 text-sm leading-relaxed">
              You contacted <span className="font-semibold text-white">{funnel.dmsSent}</span> lead(s), got{' '}
              <span className="font-semibold text-white">{funnel.replies}</span> reply(s), and closed{' '}
              <span className="font-semibold text-white">{funnel.clients}</span> client(s).
              {projection100 !== null ? (
                <> At this rate, <span className="font-semibold text-volt-text underline decoration-volt-text/30 underline-offset-4">100 leads ≈ {projection100} clients</span>.</>
              ) : (
                <> <span className="text-neutral-500">Not enough volume yet to project a rate — that needs at least {PROJECTION_MIN_SENT} contacted leads.</span></>
              )}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
         <Card hover padding="md">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Emails Sent</span>
               <div className="p-2 bg-blue-500/10 rounded-xl">
                 <Mail className="w-4 h-4 text-blue-400" />
               </div>
            </div>
            <div className="text-3xl font-semibold text-white mb-1">{funnel.sent}</div>
            <div className="text-xs text-neutral-500 font-medium">Campaign recipients mailed</div>
         </Card>

         <Card hover padding="md">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Open Rate</span>
               <div className="p-2 bg-purple-500/10 rounded-xl">
                 <MousePointerClick className="w-4 h-4 text-purple-400" />
               </div>
            </div>
            <div className="text-3xl font-semibold text-white mb-1"><Pct value={openRate} /></div>
            <div className="text-xs text-neutral-500 font-medium">{funnel.opened} of {funnel.sent} sent</div>
         </Card>

         <Card hover padding="md">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Reply Rate</span>
               <div className="p-2 bg-green-500/10 rounded-xl">
                 <Reply className="w-4 h-4 text-green-400" />
               </div>
            </div>
            <div className="text-3xl font-semibold text-white mb-1"><Pct value={replyRate} /></div>
            <div className="text-xs text-neutral-500 font-medium">{funnel.replies} of {funnel.dmsSent} contacted</div>
         </Card>

         <Card hover padding="md">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Conversion Rate</span>
               <div className="p-2 bg-amber-500/10 rounded-xl">
                 <TrendingUp className="w-4 h-4 text-amber-400" />
               </div>
            </div>
            <div className="text-3xl font-semibold text-white mb-1"><Pct value={conversionRate} /></div>
            <div className="text-xs text-neutral-500 font-medium">{funnel.clients} of {funnel.dmsSent} contacted</div>
         </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card padding="md" className="lg:col-span-2 flex flex-col min-h-[24rem]">
           <h3 className="font-semibold text-white mb-2">Engagement Breakdown</h3>
           <p className="text-xs text-neutral-500 mb-6">Counts for {periodLabel}. Bars are relative to the largest.</p>
           {hasEngagement ? (
             <div className="flex-1 flex flex-col justify-center space-y-4">
                {engagement.map((row) => (
                  <div key={row.label}>
                     <div className="flex justify-between text-xs mb-1.5">
                       <span className="font-semibold text-neutral-400 uppercase tracking-wider">{row.label}</span>
                       <span className="font-semibold text-white">{row.value}</span>
                     </div>
                     <div className="h-3 w-full bg-white/[0.04] rounded-full overflow-hidden">
                       <div
                         className={`h-full ${row.className} rounded-full transition-all duration-500`}
                         style={{ width: `${(row.value / engagementMax) * 100}%` }}
                       />
                     </div>
                  </div>
                ))}
             </div>
           ) : (
             <div className="flex-1 flex items-center justify-center text-sm text-neutral-500 text-center px-6">
               {loading ? 'Loading…' : 'No campaign activity in this period yet. Send a campaign and opens, clicks and replies will appear here.'}
             </div>
           )}
        </Card>

        <Card padding="md" className="min-h-[24rem]">
           <h3 className="font-semibold text-white mb-2 flex items-center">
             <MailWarning className="w-4 h-4 mr-2 text-neutral-400" />
             Deliverability
           </h3>
           {/* Replaced a "Top Templates" list of five invented names and rates.
               Per-template performance has no endpoint behind it; these three do,
               and they are the numbers that decide whether a domain keeps working. */}
           <p className="text-xs text-neutral-500 mb-6">How the mailbox itself is doing.</p>
           <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                 <span className="text-sm font-medium text-neutral-300">Click rate</span>
                 <span className="text-sm font-semibold text-volt-text"><Pct value={clickRate} /></span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                 <span className="text-sm font-medium text-neutral-300">Bounce rate</span>
                 <span className={`text-sm font-semibold ${bounceRate !== null && bounceRate >= 5 ? 'text-red-400' : 'text-emerald-400'}`}>
                   <Pct value={bounceRate} />
                 </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                 <span className="text-sm font-medium text-neutral-300">Bounced</span>
                 <span className="text-sm font-semibold text-white">{funnel.bounced}</span>
              </div>
           </div>
           {bounceRate !== null && bounceRate >= 5 && (
             <p className="mt-4 text-xs text-red-400 leading-relaxed">
               Above 5% puts your sending domain at risk, and campaigns auto-pause at this
               threshold. Clean the list before sending more.
             </p>
           )}
        </Card>
      </div>
    </div>
  );
};
