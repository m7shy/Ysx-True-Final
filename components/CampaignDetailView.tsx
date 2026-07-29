
import React, { useState, useEffect } from 'react';
import { Campaign, SequenceStep } from '../types';
import { ArrowLeft, Clock, CheckCircle2, PauseCircle, Users, Activity, CalendarClock } from 'lucide-react';
import { Card, Badge, Table, THead, TBody, TR, TH, TD, Spinner, Alert } from '../src/design/ui';
import { fetchCampaignRecipients, type CampaignRecipientRow } from '../services/campaignsApi';

interface CampaignDetailViewProps {
  campaign: Campaign;
  onBack: () => void;
}

/** Recipient status → badge tone. String-keyed so a status the client has not
 *  been taught about renders as itself instead of crashing the view. */
const RECIPIENT_BADGE: Record<string, 'neutral' | 'volt' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'neutral',
  SENDING: 'volt',
  IN_SEQUENCE: 'volt',
  COMPLETED: 'success',
  REPLIED: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

export const CampaignDetailView: React.FC<CampaignDetailViewProps> = ({ campaign, onBack }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'SEQUENCE' | 'RECIPIENTS'>('SEQUENCE');

  // `campaign.recipients` is always [] — the list/detail payload hardcodes it
  // (campaigns/routes.ts toClientCampaign) so a 5,000-row campaign is not
  // serialised on every render. The real rows come from their own endpoint.
  const [recipients, setRecipients] = useState<CampaignRecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRecipients(null);
    setRecipientsError(null);
    fetchCampaignRecipients(campaign.id)
      .then((r) => {
        if (active) setRecipients(r.recipients);
      })
      .catch((e: any) => {
        if (active) setRecipientsError(e?.message ?? 'Could not load recipients.');
      });
    return () => {
      // Switching campaigns fast must not let an older response overwrite a
      // newer one.
      active = false;
    };
  }, [campaign.id]);

  const getStatusIcon = (status: SequenceStep['status']) => {
    switch (status) {
      case 'SENT': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'PENDING': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'SKIPPED': return <PauseCircle className="w-5 h-5 text-neutral-400" />;
      default: return <Clock className="w-5 h-5 text-neutral-400" />;
    }
  };

  const getStepStatusVariant = (status: SequenceStep['status']): 'success' | 'warning' | 'neutral' => {
    switch (status) {
      case 'SENT': return 'success';
      case 'PENDING': return 'warning';
      case 'SKIPPED': return 'neutral';
      default: return 'neutral';
    }
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
    <div className="flex flex-col h-full bg-noir animate-in slide-in-from-right duration-300">

      {/* Header */}
      <div className="bg-white/[0.02] border-b border-white/10 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10 backdrop-blur-xl">
        <div className="flex items-start">
          <button
            onClick={onBack}
            aria-label="Back to campaigns"
            className="mr-4 p-2 rounded-full hover:bg-white/[0.05] text-neutral-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-white flex items-center gap-3">
              {campaign.name}
              <Badge variant="volt">{campaign.status}</Badge>
            </h1>
            <p className="text-sm text-neutral-400 mt-1 flex items-center">
              <span className="bg-white/[0.05] px-2 py-0.5 rounded text-xs font-mono mr-2">
                ID: {campaign.id}
              </span>
              Created on {new Date(campaign.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
           <div className="flex items-center px-4 py-2 bg-white/[0.02] rounded-full border border-white/10">
              <Users className="w-4 h-4 text-neutral-400 mr-2" />
              <span className="text-sm font-semibold text-neutral-200">
                {recipients === null ? '—' : recipients.length}
              </span>
              <span className="text-xs text-neutral-500 ml-1">Recipients</span>
           </div>
           <div className="flex items-center px-4 py-2 bg-white/[0.02] rounded-full border border-white/10">
              <Activity className="w-4 h-4 text-neutral-400 mr-2" />
              <span className="text-sm font-semibold text-neutral-200">{campaign.progress}%</span>
              <span className="text-xs text-neutral-500 ml-1">Complete</span>
           </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-white/10 bg-white/[0.02] px-6 overflow-x-auto">
        {['SEQUENCE', 'RECIPIENTS', 'OVERVIEW'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-inset ${
              activeTab === tab
                ? 'border-volt text-volt-text'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
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
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center">
              <CalendarClock className="w-5 h-5 mr-2 text-volt-text" />
              Campaign Sequence Timeline
            </h3>

            {!campaign.sequence || campaign.sequence.length === 0 ? (
              <div className="text-center py-12 bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                <p className="text-neutral-400">No sequence steps defined.</p>
              </div>
            ) : (
              <div className="relative pl-8 space-y-8 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-0.5 before:bg-white/10">
                {campaign.sequence.map((step, index) => (
                  <div key={step.id} className="relative animate-in slide-in-from-bottom-2 fade-in" style={{animationDelay: `${index * 100}ms`}}>

                    {/* Status Dot */}
                    <div className="absolute -left-[39px] top-4 w-10 h-10 rounded-full border-4 border-noir bg-white/[0.03] flex items-center justify-center z-10">
                       {getStatusIcon(step.status)}
                    </div>

                    <Card padding="md" className="group">
                       <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
                          <div className="flex items-center gap-3">
                             <div className="bg-white/[0.05] px-2 py-1 rounded text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                               Step {step.step}
                             </div>
                             <h4 className="font-semibold text-white text-sm md:text-base truncate max-w-xs md:max-w-md">
                               {step.subject}
                             </h4>
                          </div>
                          <div className="flex items-center gap-3">
                             <span className="text-xs text-neutral-400 flex items-center bg-white/[0.03] px-2 py-1 rounded border border-white/10">
                                <CalendarClock className="w-3 h-3 mr-1.5" />
                                {new Date(step.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                             </span>
                             <Badge variant={getStepStatusVariant(step.status)}>{step.status}</Badge>
                          </div>
                       </div>

                       <div className="bg-white/[0.03] rounded-xl p-4 text-sm text-neutral-300 font-mono leading-relaxed border border-white/10 overflow-hidden relative">
                          <div className="absolute top-0 left-0 w-1 h-full bg-volt opacity-50" />
                          <p className="whitespace-pre-wrap pl-2 max-h-32 overflow-y-auto custom-scrollbar">{step.body}</p>
                       </div>

                       {index < (campaign.sequence!.length - 1) && (
                          <div className="mt-4 flex items-center text-xs text-neutral-400 font-medium">
                             <ArrowLeft className="w-4 h-4 mr-2 rotate-90 md:rotate-0 transform md:-scale-x-100" />
                             Wait {formatWaitTime(new Date(campaign.sequence![index+1].scheduledFor).getTime() - new Date(step.scheduledFor).getTime())}
                          </div>
                       )}
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'RECIPIENTS' && (
           recipientsError ? (
              <Alert variant="error">{recipientsError}</Alert>
           ) : recipients === null ? (
              <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-volt-text" /></div>
           ) : recipients.length === 0 ? (
              <div className="text-center py-12 bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                 <p className="text-neutral-400">No recipients on this campaign yet.</p>
              </div>
           ) : (
              <Card padding="none" className="overflow-hidden">
                 <div className="overflow-x-auto">
                   <Table>
                      <THead>
                         <TR>
                            <TH>Name</TH>
                            <TH>Email</TH>
                            <TH>Company</TH>
                            <TH className="text-right">Status</TH>
                         </TR>
                      </THead>
                      <TBody>
                         {recipients.map((r) => (
                            <TR key={r.id} hover>
                               <TD className="font-medium text-white">{r.name}</TD>
                               <TD className="text-neutral-400">{r.email}</TD>
                               <TD className="text-neutral-400">{r.company}</TD>
                               <TD className="text-right">
                                  {/* Was hardcoded to "Pending" for every row, so
                                      even a fully-sent campaign read as untouched. */}
                                  <Badge variant={RECIPIENT_BADGE[r.status] ?? 'neutral'}>{r.status}</Badge>
                               </TD>
                            </TR>
                         ))}
                      </TBody>
                   </Table>
                 </div>
              </Card>
           )
        )}

        {activeTab === 'OVERVIEW' && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card padding="md" className="md:col-span-2">
                 <h3 className="font-semibold text-white mb-4">Performance</h3>
                 <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-500/10 rounded-xl text-center">
                       <div className="text-2xl font-semibold text-blue-400">{campaign.stats.sent}</div>
                       <div className="text-xs font-semibold text-blue-300 uppercase mt-1">Sent</div>
                    </div>
                    <div className="p-4 bg-purple-500/10 rounded-xl text-center">
                       <div className="text-2xl font-semibold text-purple-400">{campaign.stats.clicked}</div>
                       <div className="text-xs font-semibold text-purple-300 uppercase mt-1">Clicked</div>
                    </div>
                    <div className="p-4 bg-green-500/10 rounded-xl text-center">
                       <div className="text-2xl font-semibold text-green-400">{campaign.stats.replied}</div>
                       <div className="text-xs font-semibold text-green-300 uppercase mt-1">Replied</div>
                    </div>
                 </div>
              </Card>
              <Card padding="md">
                 <h3 className="font-semibold text-white mb-4">Configuration</h3>
                 <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                       <span className="text-neutral-500">Distribution</span>
                       <span className="font-medium text-neutral-300">{campaign.distributionMethod}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-neutral-500">Auto Follow-ups</span>
                       <span className="font-medium text-neutral-300">{campaign.autoFollowUps.length}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-neutral-500">Scheduled</span>
                       <span className="font-medium text-neutral-300">{new Date(campaign.scheduledAt).toLocaleDateString()}</span>
                    </div>
                 </div>
              </Card>
           </div>
        )}

      </div>
    </div>
  );
};
