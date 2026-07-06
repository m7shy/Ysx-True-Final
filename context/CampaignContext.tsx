import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Campaign, SequenceStep } from '../types';
import { useNotification } from './NotificationContext';
import { useAuth } from './AuthContext';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../services/apiClient';

interface CampaignContextType {
  campaigns: Campaign[];
  isLoading: boolean;
  addCampaign: (
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'>
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
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'>
  ) => {
    const isScheduled = campaignData.scheduledAt && new Date(campaignData.scheduledAt) > new Date();
    const status = isScheduled ? 'SCHEDULED' : 'ACTIVE';
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
      });

      setCampaigns((prev) => [data.campaign, ...prev]);

      showToast(
        'SUCCESS',
        isScheduled
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
