import React, { useEffect, useState, useRef } from 'react';
import { BarChart3, TrendingUp, Users, Mail, ArrowUpRight, MousePointerClick, Reply, Target, Phone, Zap, Briefcase, ArrowRight } from 'lucide-react';
import { getFunnelMetrics } from '../services/mockZoho';

export const AnalyticsView: React.FC = () => {
  const [funnel, setFunnel] = useState({ dmsSent: 0, replies: 0, callsBooked: 0, trials: 0, clients: 0 });
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    const loadMetrics = async () => {
      try {
        const data = await getFunnelMetrics();
        if (isMounted.current) {
          setFunnel(data);
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to load metrics", error);
        if (isMounted.current) setLoading(false);
      }
    };
    loadMetrics();

    return () => {
      isMounted.current = false;
    };
  }, []);

  // Calculations
  const replyRate = funnel.dmsSent > 0 ? ((funnel.replies / funnel.dmsSent) * 100).toFixed(1) : '0';
  const callRate = funnel.replies > 0 ? ((funnel.callsBooked / funnel.replies) * 100).toFixed(1) : '0';
  const closeRate = funnel.callsBooked > 0 ? ((funnel.clients / funnel.callsBooked) * 100).toFixed(1) : '0';
  
  const projection100 = funnel.dmsSent > 0 ? Math.round((funnel.clients / funnel.dmsSent) * 100) : 0;

  return (
    <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
            <BarChart3 className="w-6 h-6 mr-2 text-brand-500" />
            Campaign Analytics
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Performance metrics for the last 30 days.</p>
        </div>
        <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-brand-500 w-full md:w-auto">
          <option>Last 7 Days</option>
          <option selected>Last 30 Days</option>
          <option>Last Quarter</option>
        </select>
      </div>
      
      {/* Engine Performance Section */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 md:p-6 mb-8">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center">
          <Target className="w-5 h-5 mr-2 text-brand-600 dark:text-brand-400" />
          Engine Performance
        </h3>
        
        {/* Funnel Visual */}
        <div className="relative mb-8">
          {/* Connecting Line - Horizontal for Desktop */}
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-100 dark:bg-slate-800 -translate-y-1/2 hidden md:block z-0" />
          
          {/* Connecting Line - Vertical for Mobile */}
           <div className="absolute left-1/2 top-0 w-0.5 h-full bg-slate-100 dark:bg-slate-800 -translate-x-1/2 md:hidden z-0" />

          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 md:gap-4 relative z-10">
             {/* Step 1: DMs */}
             <div className="flex flex-col items-center bg-white dark:bg-slate-900 py-2">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 border-4 border-white dark:border-slate-900 flex items-center justify-center mb-2 shadow-sm">
                   <Mail className="w-6 h-6 text-slate-500 dark:text-slate-400" />
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{funnel.dmsSent}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">DMs Sent</div>
             </div>

             {/* Step 2: Replies */}
             <div className="flex flex-col items-center bg-white dark:bg-slate-900 py-2">
                <div className="w-14 h-14 rounded-full bg-brand-50 dark:bg-brand-900/20 border-4 border-white dark:border-slate-900 flex items-center justify-center mb-2 shadow-sm relative">
                   <Reply className="w-6 h-6 text-brand-500" />
                   <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-xs font-medium text-brand-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-brand-100 dark:border-brand-900/30 hidden lg:block">
                     {replyRate}%
                   </div>
                   <div className="absolute left-10 md:hidden text-xs font-medium text-brand-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-brand-100 dark:border-brand-900/30">
                     {replyRate}%
                   </div>
                </div>
                <div className="text-2xl font-bold text-brand-600 dark:text-brand-400">{funnel.replies}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Replies</div>
             </div>

             {/* Step 3: Calls */}
             <div className="flex flex-col items-center bg-white dark:bg-slate-900 py-2">
                <div className="w-14 h-14 rounded-full bg-purple-50 dark:bg-purple-900/20 border-4 border-white dark:border-slate-900 flex items-center justify-center mb-2 shadow-sm relative">
                   <Phone className="w-6 h-6 text-purple-500" />
                   <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-xs font-medium text-purple-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-purple-100 dark:border-purple-900/30 hidden lg:block">
                     {callRate}%
                   </div>
                   <div className="absolute left-10 md:hidden text-xs font-medium text-purple-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-purple-100 dark:border-purple-900/30">
                     {callRate}%
                   </div>
                </div>
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{funnel.callsBooked}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Calls Booked</div>
             </div>

             {/* Step 4: Trials */}
             <div className="flex flex-col items-center bg-white dark:bg-slate-900 py-2">
                <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 border-4 border-white dark:border-slate-900 flex items-center justify-center mb-2 shadow-sm">
                   <Zap className="w-6 h-6 text-amber-500" />
                </div>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{funnel.trials}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Trials</div>
             </div>

             {/* Step 5: Clients */}
             <div className="flex flex-col items-center bg-white dark:bg-slate-900 py-2">
                <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border-4 border-white dark:border-slate-900 flex items-center justify-center mb-2 shadow-sm relative">
                   <Briefcase className="w-6 h-6 text-emerald-500" />
                   <div className="absolute -left-8 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/30 hidden lg:block">
                     {closeRate}%
                   </div>
                   <div className="absolute left-10 md:hidden text-xs font-medium text-emerald-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/30">
                     {closeRate}%
                   </div>
                </div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{funnel.clients}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Clients Closed</div>
             </div>
          </div>
        </div>

        {/* Truth Statement */}
        <div className="bg-slate-900 dark:bg-slate-800 rounded-lg p-5 flex flex-col md:flex-row items-start md:items-center shadow-lg border border-slate-800 dark:border-slate-700 animate-in zoom-in-95 duration-500">
          <div className="p-2 bg-brand-500 rounded-lg mb-3 md:mb-0 md:mr-4 flex-shrink-0 shadow-lg shadow-brand-500/30">
             <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h4 className="text-white font-bold text-lg mb-1">The Truth</h4>
            <p className="text-slate-300 text-sm leading-relaxed">
              You sent <span className="font-bold text-white">{funnel.dmsSent}</span> DMs, got <span className="font-bold text-white">{funnel.replies}</span> replies, and closed <span className="font-bold text-white">{funnel.clients}</span> client(s). 
              At this rate, <span className="font-bold text-brand-400 underline decoration-brand-400/30 underline-offset-4">100 DMs ≈ {projection100} clients</span>.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
         {/* Standard Stats Cards - Preserved */}
         <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sent Emails</span>
               <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                 <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
               </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{funnel.dmsSent + 142}</div>
            <div className="text-xs text-green-500 font-medium flex items-center">
              <ArrowUpRight className="w-3 h-3 mr-0.5" /> +12% vs last period
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Open Rate</span>
               <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                 <MousePointerClick className="w-4 h-4 text-purple-600 dark:text-purple-400" />
               </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">42.8%</div>
            <div className="text-xs text-green-500 font-medium flex items-center">
              <ArrowUpRight className="w-3 h-3 mr-0.5" /> +5.2% vs last period
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Reply Rate</span>
               <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                 <Reply className="w-4 h-4 text-green-600 dark:text-green-400" />
               </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{replyRate}%</div>
            <div className="text-xs text-slate-400 font-medium">
              Avg industry: 8.5%
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Conversion Rate</span>
               <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                 <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
               </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{funnel.dmsSent > 0 ? ((funnel.clients / funnel.dmsSent) * 100).toFixed(1) : 0}%</div>
            <div className="text-xs text-red-500 font-medium flex items-center">
              <TrendingUp className="w-3 h-3 mr-0.5 rotate-180" /> -1.1% vs last period
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Simple CSS Bar Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-96">
           <h3 className="font-semibold text-slate-800 dark:text-white mb-8">Engagement Overview</h3>
           <div className="flex-1 flex items-end space-x-6 justify-between px-4 pb-2 border-b border-slate-100 dark:border-slate-800">
              {[65, 40, 75, 55, 90, 35, 80, 60, 45, 70, 50, 85].map((h, i) => (
                <div key={i} className="w-full h-full flex items-end group relative">
                   <div 
                     style={{ height: `${h}%` }} 
                     className="w-full bg-brand-500 rounded-t-md transition-all duration-500 hover:bg-brand-400 relative shadow-sm"
                   >
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                        {h} interactions
                        <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45"></div>
                      </div>
                   </div>
                   {/* Background Track */}
                   <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 rounded-t-md -z-10"></div>
                </div>
              ))}
           </div>
           <div className="flex justify-between mt-4 px-4 text-xs text-slate-400 uppercase font-bold tracking-widest overflow-x-auto">
              <span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Week 4</span>
           </div>
        </div>

        {/* Top Performers */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm h-96 overflow-y-auto custom-scrollbar">
           <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Top Templates</h3>
           <div className="space-y-4">
              {[
                { name: "Q3 Partnership Proposal", rate: "68%" },
                { name: "Quick Question", rate: "54%" },
                { name: "Connection Request", rate: "42%" },
                { name: "Follow-up: Bump", rate: "38%" },
                { name: "Contract Review", rate: "31%" }
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-default">
                   <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{item.name}</span>
                   <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{item.rate}</span>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};