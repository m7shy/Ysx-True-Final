import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Campaign, SequenceStep } from '../types';
import { useSettings } from './SettingsContext';
import { useNotification } from './NotificationContext';
import { useEmailProvider } from '../hooks/useEmailProvider';

// Mock Initial Campaigns
const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: 'c1',
    name: 'Q4 Sales Outreach',
    status: 'ACTIVE',
    recipients: [
      { email: 'ceo@tech.com', name: 'John Tech', company: 'Tech Inc' },
      { email: 'cto@tech.com', name: 'Jane Tech', company: 'Tech Inc' },
    ],
    subject: 'Partnership Opportunity',
    body: 'Hi, wanted to reach out...',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    distributionMethod: 'INDIVIDUAL',
    autoFollowUps: [],
    progress: 45,
    stats: { sent: 12, clicked: 3, replied: 1, opportunities: 0 },
    sequence: [
      {
        id: 's1',
        step: 1,
        subject: 'Partnership Opportunity',
        body: 'Hi, wanted to reach out...',
        scheduledFor: new Date().toISOString(),
        status: 'SENT',
        type: 'INITIAL',
      },
    ],
  },
  {
    id: 'c2',
    name: 'Webinar Invites - March',
    status: 'PAUSED',
    recipients: [],
    subject: 'Join our exclusive webinar',
    body: '...',
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    distributionMethod: 'INDIVIDUAL',
    autoFollowUps: [],
    progress: 12,
    stats: { sent: 50, clicked: 8, replied: 0, opportunities: 0 },
  },
];

interface CampaignContextType {
  campaigns: Campaign[];
  addCampaign: (
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'>
  ) => Promise<void>;
  deleteCampaign: (id: string) => void;
  toggleCampaignStatus: (id: string) => void;
  duplicateCampaign: (id: string) => void;
  renameCampaign: (id: string, newName: string) => void;
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

export const CampaignProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const { settings } = useSettings();
  const { showToast } = useNotification();
  const { sendNewEmail } = useEmailProvider();

  const addCampaign = async (
    campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'>
  ) => {
    const isScheduled = campaignData.scheduledAt && new Date(campaignData.scheduledAt) > new Date();
    const status = isScheduled ? 'SCHEDULED' : 'ACTIVE';

    // Generate Sequence (UI-only representation)
    let baseDate = new Date(campaignData.scheduledAt || Date.now());
    const sequence: SequenceStep[] = [];

    // Step 1: Initial Email
    sequence.push({
      id: `seq_${Date.now()}_1`,
      step: 1,
      subject: campaignData.subject,
      body: campaignData.body,
      scheduledFor: baseDate.toISOString(),
      status: 'PENDING',
      type: 'INITIAL',
    });

    // Subsequent Steps (Follow-ups) - cumulative schedule for UI
    campaignData.autoFollowUps.forEach((af, idx) => {
      const nextDate = new Date(baseDate.getTime());
      const delay = af.delay;
      let multiplier = 0;

      switch (af.unit) {
        case 'MINUTES':
          multiplier = 60 * 1000;
          break;
        case 'HOURS':
          multiplier = 60 * 60 * 1000;
          break;
        case 'DAYS':
          multiplier = 24 * 60 * 60 * 1000;
          break;
        case 'WEEKS':
          multiplier = 7 * 24 * 60 * 60 * 1000;
          break;
        default:
          multiplier = 24 * 60 * 60 * 1000; // Default to Days
      }

      nextDate.setTime(nextDate.getTime() + delay * multiplier);
      baseDate = nextDate; // Update base for cumulative calculation

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

    // Create new campaign object
    const newCampaign: Campaign = {
      ...campaignData,
      id: `camp_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: status,
      progress: 0,
      stats: { sent: 0, clicked: 0, replied: 0, opportunities: 0 },
      sequence: sequence,
    };

    setCampaigns((prev) => [newCampaign, ...prev]);

    // Check if First Step needs immediate execution
    if (!isScheduled) {
      try {
        let followupsAttempted = 0;
        let followupsScheduled = 0;
        const followupErrors: string[] = [];

        for (const recipient of campaignData.recipients) {
          const result = await sendNewEmail(
            recipient,
            campaignData.subject,
            campaignData.body,
            campaignData.autoFollowUps,
            { campaignId: newCampaign.id }
          );

          if (result.followups.attempted) {
            followupsAttempted += 1;
            followupsScheduled += result.followups.scheduled;
            if (result.followups.errors.length) {
              followupErrors.push(
                ...result.followups.errors.map((e) => `${recipient.email}: ${e}`)
              );
            }
          }
        }

        // Update sequence status locally
        if (newCampaign.sequence && newCampaign.sequence.length > 0) {
          newCampaign.sequence[0].status = 'SENT';
        }
        setCampaigns((prev) => prev.map((c) => (c.id === newCampaign.id ? newCampaign : c)));

        const hasAutoFollowUps = campaignData.autoFollowUps.length > 0;

        // Backend follow-ups are supported only in Gateway mode, because we need { messageId }
        const backendFollowupsEnabled = settings.useRealApi && settings.transportMode === 'gateway-imap-smtp' && hasAutoFollowUps;

        if (backendFollowupsEnabled) {
          if (followupErrors.length > 0) {
            console.error('[Follow-up Scheduling Errors]', followupErrors);
            showToast(
              'ERROR',
              `Campaign activated. Initial emails sent, but some follow-ups failed to schedule. First error: ${followupErrors[0]}`
            );
          } else {
            showToast(
              'SUCCESS',
              `Campaign activated. Initial emails sent. Scheduled ${followupsScheduled} follow-up(s) on the backend.`
            );
          }
        } else if (settings.useRealApi && hasAutoFollowUps) {
          // Real API, but not in gateway mode
          console.warn(
            'Auto-followups require Gateway mode (server /api/mail/send) so we can capture messageId + schedule follow-ups reliably.'
          );
          showToast(
            'SUCCESS',
            'Campaign activated. Initial emails sent. Note: Auto-followups require Gateway mode to schedule on the backend.'
          );
        } else {
          // Mock mode or no follow-ups
          showToast('SUCCESS', `Campaign "${campaignData.name}" activated!`);
        }
      } catch (error: any) {
        showToast('ERROR', `Failed to send campaign: ${error.message}`);
      }
    } else {
      showToast(
        'SUCCESS',
        `Campaign "${campaignData.name}" scheduled for ${new Date(campaignData.scheduledAt).toLocaleString()} (EST).`
      );
    }
  };

  const deleteCampaign = (id: string) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    showToast('SUCCESS', 'Campaign deleted.');
  };

  const toggleCampaignStatus = (id: string) => {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const newStatus = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
          return { ...c, status: newStatus };
        }
        return c;
      })
    );
  };

  const duplicateCampaign = (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) return;

    const copy: Campaign = {
      ...campaign,
      id: `camp_${Date.now()}`,
      name: `Copy of ${campaign.name}`,
      status: 'DRAFT',
      progress: 0,
      stats: { sent: 0, clicked: 0, replied: 0, opportunities: 0 },
      createdAt: new Date().toISOString(),
      sequence: campaign.sequence?.map((s) => ({ ...s, status: 'PENDING', scheduledFor: new Date().toISOString() })),
    };

    setCampaigns((prev) => [copy, ...prev]);
    showToast('SUCCESS', 'Campaign duplicated as draft.');
  };

  const renameCampaign = (id: string, newName: string) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    showToast('SUCCESS', 'Campaign renamed.');
  };

  return (
    <CampaignContext.Provider
      value={{ campaigns, addCampaign, deleteCampaign, toggleCampaignStatus, duplicateCampaign, renameCampaign }}
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
