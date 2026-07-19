
import React, { useEffect, useState } from 'react';
import { DollarSign, Clock, Activity, TrendingUp, AlertTriangle, Crown, Frown, Loader2 } from 'lucide-react';
import { getEfficiencyStats, getRecentProjects, EfficiencyStats, Project } from '../services/mockPerformance';
import { Card, Table, THead, TBody, TR, TH, TD, Spinner } from '../src/design/ui';

export const PerformanceView: React.FC = () => {
  const [stats, setStats] = useState<EfficiencyStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const [statsData, projectsData] = await Promise.all([
        getEfficiencyStats(),
        getRecentProjects()
      ]);
      setStats(statsData);
      setProjects(projectsData);
      setLoading(false);
    };
    loadData();
  }, []);

  if (loading || !stats) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={32} className="text-volt-text" />
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">

      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-white flex items-center">
          <TrendingUp className="w-6 h-6 mr-2 text-volt-text" />
          Performance & Money
        </h2>
        <p className="text-neutral-400 mt-1">Tracking the profitability and efficiency of your editing business.</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Total Revenue</div>
            <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-semibold text-white">{formatCurrency(stats.totalRevenue)}</div>
        </Card>

        <Card>
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Effective Hourly</div>
            <div className="p-2 bg-volt/15 rounded-lg text-volt-text">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-semibold text-white">{formatCurrency(stats.avgHourlyRate)}<span className="text-sm text-neutral-400 font-normal">/hr</span></div>
        </Card>

        <Card>
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Hours Logged</div>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-semibold text-white">{stats.totalHours}h</div>
        </Card>

        <Card>
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Active Projects</div>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Loader2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-semibold text-white">{stats.activeProjectsCount}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">

        {/* Client Tier List */}
        <Card padding="none" className="lg:col-span-2 overflow-hidden">
          <div className="p-6 border-b border-white/10">
            <h3 className="font-semibold text-white">Client Efficiency Tier List</h3>
            <p className="text-xs text-neutral-500">Ranked by Effective Hourly Rate (Fee ÷ Hours)</p>
          </div>
          <div className="p-6 space-y-3">

            {/* S Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-purple-600 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0 z-10">S</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.S.length > 0 ? stats.tiers.S.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-semibold text-purple-300 border border-purple-500/25 flex items-center">
                     <Crown className="w-3 h-3 mr-1 text-yellow-500" /> {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">No S-Tier clients yet. Aim for {'>'}$200/hr.</span>}
              </div>
            </div>

            {/* A Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-emerald-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">A</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.A.length > 0 ? stats.tiers.A.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-medium text-emerald-300 border border-emerald-500/25">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">Empty. Range: $125-$200/hr.</span>}
              </div>
            </div>

            {/* B Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-blue-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">B</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.B.length > 0 ? stats.tiers.B.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-medium text-blue-300 border border-blue-500/25">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">Empty. Range: $80-$125/hr.</span>}
              </div>
            </div>

            {/* C Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-yellow-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">C</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.C.length > 0 ? stats.tiers.C.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-medium text-yellow-300 border border-yellow-500/25">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">Empty. Range: $50-$80/hr.</span>}
              </div>
            </div>

            {/* D Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-orange-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">D</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.D.length > 0 ? stats.tiers.D.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-medium text-orange-300 border border-orange-500/25">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">Empty. Range: $30-$50/hr.</span>}
              </div>
            </div>

            {/* F Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-red-600 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">F</div>
              <div className="flex-1 bg-white/[0.03] rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-white/10">
                 {stats.tiers.F.length > 0 ? stats.tiers.F.map(p => (
                   <span key={p.id} className="bg-white/[0.06] px-2 py-1 rounded text-xs font-medium text-red-300 border border-red-500/25 flex items-center">
                      <Frown className="w-3 h-3 mr-1" /> {p.clientName}
                   </span>
                 )) : <span className="text-xs text-neutral-500 italic">Great job! No F-Tier clients ({'<'}$30/hr).</span>}
              </div>
            </div>

          </div>
        </Card>

        {/* Bottleneck Analysis */}
        <Card>
           <h3 className="font-semibold text-white mb-4 flex items-center">
             <AlertTriangle className="w-5 h-5 mr-2 text-amber-400" />
             Bottleneck Analysis
           </h3>

           <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-5 mb-6 text-center">
              <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-2">Time Drain Alert</p>
              <div className="text-3xl font-black text-white mb-1">{stats.bottleneck.worstType}</div>
              <p className="text-sm text-neutral-300">
                Averaging <span className="font-semibold text-red-400">{stats.bottleneck.avgRevisions.toFixed(1)} revisions</span> per project.
              </p>
           </div>

           <div className="space-y-3">
              <h4 className="text-xs font-semibold text-neutral-500 uppercase">Recommendation</h4>
              <div className="text-sm text-neutral-300 leading-relaxed">
                 Your <strong>{stats.bottleneck.worstType}</strong> projects are killing your effective hourly rate due to excessive revisions.
                 <br/><br/>
                 Consider raising your fee for this service type by <strong>20%</strong> or enforcing a stricter revision limit clause in your contract.
              </div>
           </div>
        </Card>
      </div>

      {/* Project Log Table */}
      <Card padding="none" className="overflow-hidden">
         <div className="p-6 border-b border-white/10">
            <h3 className="font-semibold text-white">Recent Project Log</h3>
         </div>
         <Table>
           <THead>
             <TR hover={false}>
               <TH>Client</TH>
               <TH>Type</TH>
               <TH>Fee</TH>
               <TH>Hours</TH>
               <TH>Revisions</TH>
               <TH>$/Hour</TH>
             </TR>
           </THead>
           <TBody>
              {projects.map(p => {
                const hourly = p.hoursLogged > 0 ? p.fee / p.hoursLogged : 0;
                return (
                  <TR key={p.id}>
                    <TD className="font-medium text-white">{p.clientName}</TD>
                    <TD>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/[0.06] text-neutral-300">
                        {p.type}
                      </span>
                    </TD>
                    <TD>{formatCurrency(p.fee)}</TD>
                    <TD>{p.hoursLogged}</TD>
                    <TD>
                      <span className={`font-semibold ${p.revisions > 3 ? 'text-red-400' : 'text-neutral-400'}`}>
                         {p.revisions}
                      </span>
                    </TD>
                    <TD>
                      <span className={`font-semibold px-2 py-1 rounded ${
                        hourly >= 100 ? 'bg-green-500/15 text-green-400' :
                        hourly <= 30 ? 'bg-red-500/15 text-red-400' :
                        'text-neutral-300'
                      }`}>
                        {formatCurrency(hourly)}
                      </span>
                    </TD>
                  </TR>
                );
              })}
           </TBody>
         </Table>
      </Card>

    </div>
  );
};
