
import React, { useEffect, useState } from 'react';
import { DollarSign, Clock, Activity, TrendingUp, AlertTriangle, Crown, Frown, Loader2 } from 'lucide-react';
import { getEfficiencyStats, getRecentProjects, EfficiencyStats, Project } from '../services/mockPerformance';

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
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
      
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
          <TrendingUp className="w-6 h-6 mr-2 text-brand-500" />
          Performance & Money
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Tracking the profitability and efficiency of your editing business.</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Revenue</div>
            <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-green-600">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(stats.totalRevenue)}</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Effective Hourly</div>
            <div className="p-2 bg-brand-50 dark:bg-brand-900/20 rounded-lg text-brand-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(stats.avgHourlyRate)}<span className="text-sm text-slate-400 font-normal">/hr</span></div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hours Logged</div>
            <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalHours}h</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Projects</div>
            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-purple-600">
              <Loader2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.activeProjectsCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        
        {/* Client Tier List */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white">Client Efficiency Tier List</h3>
            <p className="text-xs text-slate-500">Ranked by Effective Hourly Rate (Fee ÷ Hours)</p>
          </div>
          <div className="p-6 space-y-3">
            
            {/* S Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-purple-600 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0 shadow-lg z-10">S</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.S.length > 0 ? stats.tiers.S.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-bold text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-900/30 flex items-center">
                     <Crown className="w-3 h-3 mr-1 text-yellow-500" /> {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">No S-Tier clients yet. Aim for {'>'}$200/hr.</span>}
              </div>
            </div>

            {/* A Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-emerald-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">A</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.A.length > 0 ? stats.tiers.A.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/30">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">Empty. Range: $125-$200/hr.</span>}
              </div>
            </div>

            {/* B Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-blue-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">B</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.B.length > 0 ? stats.tiers.B.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900/30">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">Empty. Range: $80-$125/hr.</span>}
              </div>
            </div>

            {/* C Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-yellow-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">C</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.C.length > 0 ? stats.tiers.C.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-medium text-yellow-700 dark:text-yellow-300 border border-yellow-100 dark:border-yellow-900/30">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">Empty. Range: $50-$80/hr.</span>}
              </div>
            </div>

            {/* D Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-orange-500 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">D</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.D.length > 0 ? stats.tiers.D.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-medium text-orange-700 dark:text-orange-300 border border-orange-100 dark:border-orange-900/30">
                     {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">Empty. Range: $30-$50/hr.</span>}
              </div>
            </div>

            {/* F Tier */}
            <div className="flex items-stretch">
              <div className="w-16 bg-red-600 text-white font-black text-xl flex items-center justify-center rounded-l-lg shrink-0">F</div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-r-lg p-3 flex flex-wrap gap-2 items-center border border-slate-100 dark:border-slate-700">
                 {stats.tiers.F.length > 0 ? stats.tiers.F.map(p => (
                   <span key={p.id} className="bg-white dark:bg-slate-700 px-2 py-1 rounded shadow-sm text-xs font-medium text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/30 flex items-center">
                      <Frown className="w-3 h-3 mr-1" /> {p.clientName}
                   </span>
                 )) : <span className="text-xs text-slate-400 italic">Great job! No F-Tier clients ({'<'}$30/hr).</span>}
              </div>
            </div>

          </div>
        </div>

        {/* Bottleneck Analysis */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
           <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center">
             <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" />
             Bottleneck Analysis
           </h3>
           
           <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50 rounded-xl p-5 mb-6 text-center">
              <p className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider mb-2">Time Drain Alert</p>
              <div className="text-3xl font-black text-slate-900 dark:text-white mb-1">{stats.bottleneck.worstType}</div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Averaging <span className="font-bold text-red-500">{stats.bottleneck.avgRevisions.toFixed(1)} revisions</span> per project.
              </p>
           </div>

           <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase">Recommendation</h4>
              <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                 Your <strong>{stats.bottleneck.worstType}</strong> projects are killing your effective hourly rate due to excessive revisions.
                 <br/><br/>
                 Consider raising your fee for this service type by <strong>20%</strong> or enforcing a stricter revision limit clause in your contract.
              </div>
           </div>
        </div>
      </div>

      {/* Project Log Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
         <div className="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white">Recent Project Log</h3>
         </div>
         <div className="overflow-x-auto">
           <table className="w-full text-left text-sm">
             <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 uppercase text-xs font-bold border-b border-slate-200 dark:border-slate-800">
               <tr>
                 <th className="px-6 py-4">Client</th>
                 <th className="px-6 py-4">Type</th>
                 <th className="px-6 py-4">Fee</th>
                 <th className="px-6 py-4">Hours</th>
                 <th className="px-6 py-4">Revisions</th>
                 <th className="px-6 py-4">$/Hour</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {projects.map(p => {
                  const hourly = p.hoursLogged > 0 ? p.fee / p.hoursLogged : 0;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{p.clientName}</td>
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {p.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{formatCurrency(p.fee)}</td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{p.hoursLogged}</td>
                      <td className="px-6 py-4">
                        <span className={`font-bold ${p.revisions > 3 ? 'text-red-500' : 'text-slate-600 dark:text-slate-400'}`}>
                           {p.revisions}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-bold px-2 py-1 rounded ${
                          hourly >= 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                          hourly <= 30 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 
                          'text-slate-700 dark:text-slate-300'
                        }`}>
                          {formatCurrency(hourly)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
             </tbody>
           </table>
         </div>
      </div>

    </div>
  );
};
