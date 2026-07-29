import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Campaign, SequenceStep } from '../types';
import { useNotification } from './NotificationContext';
import { useAuth } from './AuthContext';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../services/apiClient';

interface CampaignContextType {
  campaigns: Campaign[];
  isLoading: boolean;
  addCampaign: (
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'> & {
      // Optional explicit status override (e.g. the wizard's "Save as
      // Draft"); when omitted, addCampaign derives ACTIVE/SCHEDULED from
      // scheduledAt as before.
      status?: Campaign['status'];
    }
  ) => Promise<void>;
  deleteCampaign: (id: string) => void;
  toggleCampaignStatus: (id: string) => void;
  duplicateCampaign: (id: string) => void;
  renameCampaign: (id: string, newName: string) => void;
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

function buildSequence(campaignData: {
  subject: string;
  body: string;
  scheduledAt: string;
  autoFollowUps: Campaign['autoFollowUps'];
}): SequenceStep[] {
  let baseDate = new Date(campaignData.scheduledAt || Date.now());
  const sequence: SequenceStep[] = [];

  sequence.push({
    id: `seq_${Date.now()}_1`,
    step: 1,
    subject: campaignData.subject,
    body: campaignData.body,
    scheduledFor: baseDate.toISOString(),
    status: 'PENDING',
    type: 'INITIAL',
  });

  campaignData.autoFollowUps.forEach((af, idx) => {
    const nextDate = new Date(baseDate.getTime());
    const multiplier =
      af.unit === 'MINUTES' ? 60 * 1000 :
      af.unit === 'HOURS' ? 60 * 60 * 1000 :
      af.unit === 'WEEKS' ? 7 * 24 * 60 * 60 * 1000 :
      24 * 60 * 60 * 1000; // DAYS (default)

    nextDate.setTime(nextDate.getTime() + af.delay * multiplier);
    baseDate = nextDate;

    sequence.push({
      id: `seq_${Date.now()}_${idx + 2}`,
      step: idx + 2,
      subject: `Re: ${campaignData.subject}`,
      body: af.content,
      scheduledFor: nextDate.toISOString(),
      status: 'PENDING',
      type: 'FOLLOW_UP',
    });
  });

  return sequence;
}

/**
 * The fields that describe HOW a campaign sends — window, days, pacing, tracking
 * and the stop-on-* rules — as opposed to what it says.
 *
 * These are collected by the wizard's Setup step, declared on `Campaign`, and
 * stored as real columns, but `addCampaign` posted only
 * name/subject/body/schedule/recipients and dropped all thirteen, while
 * `duplicateCampaign` never copied them either. A campaign the user throttled to
 * 40/day on weekdays 09:00–18:00 in the prospect's timezone was therefore created
 * with none of it: no window, no day restriction, no daily limit, no interval —
 * it sent around the clock, seven days a week, as fast as the worker would go.
 * Nothing surfaced the loss, because every field is optional server-side and
 * simply fell back to a column default.
 *
 * Nulls are dropped rather than forwarded: each field on the create schema is
 * `.optional()`, which accepts `undefined` but REJECTS `null`, and these columns
 * are null on any campaign that never set them — so spreading a fetched campaign
 * straight into the payload would 400 on exactly the common case.
 */
type CampaignSendingConfig = Partial<
  Pick<
    Campaign,
    | 'sendWindowStart'
    | 'sendWindowEnd'
    | 'sendDays'
    | 'timezone'
    | 'dailyLimit'
    | 'sendIntervalMinutes'
    | 'stopOnReply'
    | 'stopOnClick'
    | 'stopOnOpen'
    | 'plainTextMode'
    | 'followUpPercent'
    | 'openTracking'
    | 'linkTracking'
  >
>;

export function sendingConfigPayload(source: CampaignSendingConfig): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const put = (key: keyof CampaignSendingConfig, value: unknown): void => {
    if (value !== undefined && value !== null) payload[key] = value;
  };

  // The send window is validated as a PAIR (requireCompleteSendWindow): one end
  // without the other is a 400, because a half-configured window is silently
  // ignored by isWithinSendWindow. Both or neither.
  if (source.sendWindowStart != null && source.sendWindowEnd != null) {
    payload.sendWindowStart = source.sendWindowStart;
    payload.sendWindowEnd = source.sendWindowEnd;
  }

  // `sendDays: 0` sets no day at all, which the send engine reads as "never
  // send"; the server refuses it now, so only a row predating that validation
  // can carry it. It cannot be copied, so it degrades to "no day restriction" —
  // safe here because a duplicate is always created as a DRAFT and cannot send
  // until the user activates it deliberately.
  put('sendDays', source.sendDays || undefined);

  put('timezone', source.timezone);
  put('dailyLimit', source.dailyLimit);
  put('sendIntervalMinutes', source.sendIntervalMinutes);
  put('stopOnReply', source.stopOnReply);
  put('stopOnClick', source.stopOnClick);
  put('stopOnOpen', source.stopOnOpen);
  put('plainTextMode', source.plainTextMode);
  put('followUpPercent', source.followUpPercent);
  put('openTracking', source.openTracking);
  put('linkTracking', source.linkTracking);

  return payload;
}

export const CampaignProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isLoggedIn } = useAuth();
  const { showToast } = useNotification();

  const loadCampaigns = async () => {
    setIsLoading(true);
    try {
      const data = await apiGet<{ campaigns: Campaign[] }>('/api/campaigns');
      setCampaigns(data.campaigns);
    } catch (err) {
      console.error('Failed to load campaigns', err);
      showToast('ERROR', 'Failed to load campaigns.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadCampaigns();
    } else {
      setCampaigns([]);
      setIsLoading(false);
    }
  }, [isLoggedIn]);

  const addCampaign = async (
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'> & {
      status?: Campaign['status'];
    }
  ) => {
    const isScheduled = campaignData.scheduledAt && new Date(campaignData.scheduledAt) > new Date();
    const status = campaignData.status ?? (isScheduled ? 'SCHEDULED' : 'ACTIVE');
    const sequence = buildSequence(campaignData);

    try {
      const data = await apiPost<{ campaign: Campaign }>('/api/campaigns', {
        name: campaignData.name,
        subject: campaignData.subject,
        body: campaignData.body,
        scheduledAt: campaignData.scheduledAt,
        status,
        distributionMethod: campaignData.distributionMethod,
        autoFollowUps: campaignData.autoFollowUps,
        sequence,
        recipients: campaignData.recipients,
        // Everything the Setup step configured. Without this the whole of that
        // step was collected, typed through, and discarded.
        ...sendingConfigPayload(campaignData),
      });

      setCampaigns((prev) => [data.campaign, ...prev]);

      showToast(
        'SUCCESS',
        status === 'DRAFT'
          ? `Campaign "${campaignData.name}" saved as a draft.`
          : isScheduled
          ? `Campaign "${campaignData.name}" scheduled for ${new Date(campaignData.scheduledAt).toLocaleString()}.`
          : `Campaign "${campaignData.name}" activated. The outbound engine will begin dispatching shortly.`
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create campaign.';
      showToast('ERROR', message);
      throw err;
    }
  };

  const deleteCampaign = async (id: string) => {
    const previous = campaigns;
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    try {
      await apiDelete(`/api/campaigns/${id}`);
      showToast('SUCCESS', 'Campaign deleted.');
    } catch (err) {
      setCampaigns(previous);
      const message = err instanceof ApiError ? err.message : 'Failed to delete campaign.';
      showToast('ERROR', message);
    }
  };

  const toggleCampaignStatus = async (id: string) => {
    const current = campaigns.find((c) => c.id === id);
    if (!current) return;
    const newStatus = current.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c)));
    try {
      await apiPatch(`/api/campaigns/${id}`, { status: newStatus });
    } catch (err) {
      setCampaigns((prev) => prev.map((c) => (c.id === id ? current : c)));
      const message = err instanceof ApiError ? err.message : 'Failed to update campaign status.';
      showToast('ERROR', message);
    }
  };

  const duplicateCampaign = async (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) return;

    try {
      const data = await apiPost<{ campaign: Campaign }>('/api/campaigns', {
        name: `Copy of ${campaign.name}`,
        subject: campaign.subject,
        body: campaign.body,
        scheduledAt: campaign.scheduledAt,
        status: 'DRAFT',
        distributionMethod: campaign.distributionMethod,
        autoFollowUps: campaign.autoFollowUps,
        sequence: campaign.sequence?.map((s) => ({ ...s, status: 'PENDING', scheduledFor: new Date().toISOString() })),
        // A copy must send the way the original does. Without this, duplicating
        // a carefully-throttled campaign produced one with no window, no day
        // restriction and no daily limit — and "Copy of X" gives the user no
        // reason to suspect it. Recipients are deliberately NOT copied (the
        // copy starts empty, as it always has).
        ...sendingConfigPayload(campaign),
      });
      setCampaigns((prev) => [data.campaign, ...prev]);
      showToast('SUCCESS', 'Campaign duplicated as draft.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to duplicate campaign.';
      showToast('ERROR', message);
    }
  };

  const renameCampaign = async (id: string, newName: string) => {
    const previous = campaigns;
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    try {
      await apiPatch(`/api/campaigns/${id}`, { name: newName });
      showToast('SUCCESS', 'Campaign renamed.');
    } catch (err) {
      setCampaigns(previous);
      const message = err instanceof ApiError ? err.message : 'Failed to rename campaign.';
      showToast('ERROR', message);
    }
  };

  return (
    <CampaignContext.Provider
      value={{ campaigns, isLoading, addCampaign, deleteCampaign, toggleCampaignStatus, duplicateCampaign, renameCampaign }}
    >
      {children}
    </CampaignContext.Provider>
  );
};

export const useCampaigns = () => {
  const context = useContext(CampaignContext);
  if (!context) {
    throw new Error('useCampaigns must be used within a CampaignProvider');
  }
  return context;
};
