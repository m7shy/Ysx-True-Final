
import React, { useState } from 'react';
import { Campaign, SequenceStep } from '../types';
import { ArrowLeft, Clock, CheckCircle2, PauseCircle, Send, Users, Activity, CalendarClock, ChevronRight, Mail } from 'lucide-react';

interface CampaignDetailViewProps {
  campaign: Campaign;
  onBack: () => void;
}

export const CampaignDetailView: React.FC<CampaignDetailViewProps> = ({ campaign, onBack }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'SEQUENCE' | 'RECIPIENTS'>('SEQUENCE');

  const getStatusIcon = (status: SequenceStep['status']) => {
    switch (status) {
      case 'SENT': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'PENDING': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'SKIPPED': return <PauseCircle className="w-5 h-5 text-slate-400" />;
      default: return <Clock className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStepStatusBadge = (status: SequenceStep['status']) => {
    const styles = {
      'SENT': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      'PENDING': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      'SKIPPED': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const formatWaitTime = (millis: number) => {
    const minutes = Math.round(millis / (60 * 1000));
    const hours = Math.round(millis / (60 * 60 * 1000));
    const days = Math.round(millis / (24 * 60 * 60 * 1000));
    const weeks = Math.round(millis / (7 * 24 * 60 * 60 * 1000));

    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''}`;
    return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0B1120] animate-in slide-in-from-right duration-300">
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10">
        <div className="flex items-start">
          <button 
            onClick={onBack}
            className="mr-4 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              {campaign.name}
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400`}>
                {campaign.status}
              </span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center">
              <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs font-mono mr-2">
                ID: {campaign.id}
              </span>
              Created on {new Date(campaign.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
           <div className="flex items-center px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <Users className="w-4 h-4 text-slate-400 mr-2" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{campaign.recipients.length}</span>
              <span className="text-xs text-slate-500 ml-1">Recipients</span>
           </div>
           <div className="flex items-center px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <Activity className="w-4 h-4 text-slate-400 mr-2" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{campaign.progress}%</span>
              <span className="text-xs text-slate-500 ml-1">Complete</span>
           </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6">
        {['SEQUENCE', 'RECIPIENTS', 'OVERVIEW'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab.charAt(0) + tab.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        
        {activeTab === 'SEQUENCE' && (
          <div className="max-w-4xl mx-auto">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center">
              <CalendarClock className="w-5 h-5 mr-2 text-blue-500" />
              Campaign Sequence Timeline
            </h3>

            {!campaign.sequence || campaign.sequence.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                <p className="text-slate-500">No sequence steps defined.</p>
              </div>
            ) : (
              <div className="relative pl-8 space-y-8 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                {campaign.sequence.map((step, index) => (
                  <div key={step.id} className="relative animate-in slide-in-from-bottom-2 fade-in" style={{animationDelay: `${index * 100}ms`}}>
                    
                    {/* Status Dot */}
                    <div className={`absolute -left-[39px] top-4 w-10 h-10 rounded-full border-4 border-slate-50 dark:border-[#0B1120] bg-white dark:bg-slate-900 flex items-center justify-center z-10`}>
                       {getStatusIcon(step.status)}
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 hover:shadow-md transition-shadow group">
                       <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
                          <div className="flex items-center gap-3">
                             <div className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                               Step {step.step}
                             </div>
                             <h4 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate max-w-xs md:max-w-md">
                               {step.subject}
                             </h4>
                          </div>
                          <div className="flex items-center gap-3">
                             <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded border border-slate-100 dark:border-slate-800">
                                <CalendarClock className="w-3 h-3 mr-1.5" />
                                {new Date(step.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                             </span>
                             {getStepStatusBadge(step.status)}
                          </div>
                       </div>

                       <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 text-sm text-slate-600 dark:text-slate-300 font-mono leading-relaxed border border-slate-100 dark:border-slate-800 overflow-hidden relative">
                          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 opacity-50" />
                          <p className="whitespace-pre-wrap pl-2 max-h-32 overflow-y-auto custom-scrollbar">{step.body}</p>
                       </div>

                       {index < (campaign.sequence!.length - 1) && (
                          <div className="mt-4 flex items-center text-xs text-slate-400 font-medium">
                             <ArrowLeft className="w-4 h-4 mr-2 rotate-90 md:rotate-0 transform md:-scale-x-100" />
                             Wait {formatWaitTime(new Date(campaign.sequence![index+1].scheduledFor).getTime() - new Date(step.scheduledFor).getTime())}
                          </div>
                       )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'RECIPIENTS' && (
           <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <table className="w-full text-left text-sm">
                 <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase font-bold text-slate-500">
                    <tr>
                       <th className="px-6 py-4">Name</th>
                       <th className="px-6 py-4">Email</th>
                       <th className="px-6 py-4">Company</th>
                       <th className="px-6 py-4 text-right">Status</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {campaign.recipients.map((r, i) => (
                       <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{r.name}</td>
                          <td className="px-6 py-4 text-slate-500">{r.email}</td>
                          <td className="px-6 py-4 text-slate-500">{r.company}</td>
                          <td className="px-6 py-4 text-right">
                             <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Pending
                             </span>
                          </td>
                       </tr>
                    ))}
                 </tbody>
              </table>
           </div>
        )}

        {activeTab === 'OVERVIEW' && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                 <h3 className="font-bold text-slate-900 dark:text-white mb-4">Performance</h3>
                 <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg text-center">
                       <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{campaign.stats.sent}</div>
                       <div className="text-xs font-bold text-blue-400 dark:text-blue-300 uppercase mt-1">Sent</div>
                    </div>
                    <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-lg text-center">
                       <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{campaign.stats.clicked}</div>
                       <div className="text-xs font-bold text-purple-400 dark:text-purple-300 uppercase mt-1">Clicked</div>
                    </div>
                    <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg text-center">
                       <div className="text-2xl font-bold text-green-600 dark:text-green-400">{campaign.stats.replied}</div>
                       <div className="text-xs font-bold text-green-400 dark:text-green-300 uppercase mt-1">Replied</div>
                    </div>
                 </div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                 <h3 className="font-bold text-slate-900 dark:text-white mb-4">Configuration</h3>
                 <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                       <span className="text-slate-500">Distribution</span>
                       <span className="font-medium text-slate-700 dark:text-slate-300">{campaign.distributionMethod}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-slate-500">Auto Follow-ups</span>
                       <span className="font-medium text-slate-700 dark:text-slate-300">{campaign.autoFollowUps.length}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-slate-500">Scheduled</span>
                       <span className="font-medium text-slate-700 dark:text-slate-300">{new Date(campaign.scheduledAt).toLocaleDateString()}</span>
                    </div>
                 </div>
              </div>
           </div>
        )}

      </div>
    </div>
  );
};
