import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { StepProgress, WizardStep } from './StepProgress';
import { Step1ImportLeads } from './steps/Step1ImportLeads';
import { Step2Sequences } from './steps/Step2Sequences';
import { Step3Setup } from './steps/Step3Setup';
import { Step4Review } from './steps/Step4Review';
import {
  CampaignSettings,
  CsvData,
  Lead as WizardLead,
  MappingField,
  ScheduleConfig,
  SequenceStage,
} from './types';
import { DEFAULT_SCHEDULE, DEFAULT_SEQUENCE, DEFAULT_SETTINGS } from './defaults';
import { buildLeads } from './utils';
import { useCampaigns } from '../../../context/CampaignContext';
import type { AutoFollowUp, Recipient } from '../../../types';

const STEPS: WizardStep[] = [
  { id: 1, label: 'Import Leads' },
  { id: 2, label: 'Sequences' },
  { id: 3, label: 'Setup' },
  { id: 4, label: 'Final Review' },
];

const DAY_KEYS: (keyof ScheduleConfig['sendDays'])[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}

function scheduleToSendDaysBitmask(sendDays: ScheduleConfig['sendDays']): number {
  return DAY_KEYS.reduce((mask, key, i) => (sendDays[key] ? mask | (1 << i) : mask), 0);
}

function wizardLeadToRecipient(lead: WizardLead): Recipient {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
  return {
    email: lead.email,
    name,
    company: lead.company ?? '',
    customFields: lead.custom,
  };
}

/** Convert the wizard's stage list into the backend's autoFollowUps[] (delay/unit/content). */
function stagesToAutoFollowUps(stages: SequenceStage[]): AutoFollowUp[] {
  return stages.slice(1).map((s) => ({
    delay: s.waitDays,
    unit: 'DAYS' as const,
    content: s.variants[0]?.body ?? '',
  }));
}

interface CampaignWizardProps {
  initialName?: string;
  initialLead?: { email: string; name: string; company: string };
  onClose: () => void;
}

export const CampaignWizard: React.FC<CampaignWizardProps> = ({ initialName, initialLead, onClose }) => {
  const { addCampaign } = useCampaigns();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initialName || 'New Campaign');

  // Step 1 state
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, MappingField>>({});
  const [crmLeads, setCrmLeads] = useState<WizardLead[]>(
    initialLead
      ? [
          {
            email: initialLead.email,
            first_name: initialLead.name?.split(' ')[0],
            last_name: initialLead.name?.split(' ').slice(1).join(' ') || undefined,
            company: initialLead.company || undefined,
            custom: {},
          },
        ]
      : []
  );

  // Step 2 state
  const [sequence, setSequence] = useState<SequenceStage[]>(DEFAULT_SEQUENCE);

  // Step 3 state
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  const [settings, setSettings] = useState<CampaignSettings>(DEFAULT_SETTINGS);
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const csvLeads: WizardLead[] = useMemo(() => (csv ? buildLeads(csv, mapping) : []), [csv, mapping]);
  const leads: WizardLead[] = useMemo(() => [...crmLeads, ...csvLeads], [crmLeads, csvLeads]);

  const emailMapped = useMemo(() => {
    if (!csv) return crmLeads.length > 0;
    return csv.headers.some((h) => mapping[h] === 'email') || crmLeads.length > 0;
  }, [csv, mapping, crmLeads]);

  const canAdvance = (from: number): boolean => {
    switch (from) {
      case 1:
        return leads.length > 0 && emailMapped;
      case 2:
        return sequence.every((s) => s.variants.every((v) => v.body.trim().length > 0));
      case 3:
        return name.trim().length > 0;
      default:
        return true;
    }
  };

  const completed = useMemo(() => {
    const done = new Set<number>();
    for (let i = 1; i < step; i++) done.add(i);
    return done;
  }, [step]);

  const handleClearCsv = () => {
    setCsv(null);
    setFileName(null);
    setMapping({});
  };

  const handleCsvLoaded = (data: CsvData, file: string, newMapping: Record<string, MappingField>) => {
    setCsv(data);
    setFileName(file);
    setMapping(newMapping);
  };

  const submit = async (asDraft: boolean): Promise<void> => {
    setSubmitError(null);
    setSubmitting(true);
    const main = sequence[0]?.variants[0];
    const scheduledAt = startNow ? new Date().toISOString() : new Date(startAt).toISOString();
    const recipients = leads.map(wizardLeadToRecipient);

    try {
      await addCampaign({
        name,
        subject: main?.subject ?? '',
        body: main?.body ?? '',
        scheduledAt,
        recipients,
        distributionMethod: 'INDIVIDUAL',
        autoFollowUps: stagesToAutoFollowUps(sequence),
        sendWindowStart: timeToMinutes(schedule.startTime),
        sendWindowEnd: timeToMinutes(schedule.endTime),
        sendDays: scheduleToSendDaysBitmask(schedule.sendDays),
        timezone: schedule.timezone,
        dailyLimit: schedule.maxNewLeadsPerDay,
        stopOnReply: settings.stopOnReply,
        openTracking: true,
        linkTracking: true,
        // Extended wizard fields — forwarded through CampaignContext.addCampaign.
        sendIntervalMinutes: schedule.intervalMinutes,
        stopOnClick: settings.stopOnClick,
        stopOnOpen: settings.stopOnOpen,
        plainTextMode: settings.plainTextMode,
        followUpPercent: settings.followUpPercent,
        status: asDraft ? 'DRAFT' : startNow ? 'ACTIVE' : 'SCHEDULED',
      });
      onClose();
    } catch (err) {
      console.error(err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to start campaign.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col h-full bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur-sm px-4 md:px-6 py-4 flex items-center gap-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-2 py-1 -ml-2 w-64"
          aria-label="Campaign name"
        />
        <div className="flex-1 min-w-0">
          <StepProgress
            steps={STEPS}
            current={step}
            completed={completed}
            onSelect={(s) => {
              if (s <= step || [...Array(s - 1)].every((_, i) => canAdvance(i + 1))) {
                setStep(s);
              }
            }}
          />
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white">
          Close
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {step === 1 && (
          <Step1ImportLeads
            csv={csv}
            fileName={fileName}
            mapping={mapping}
            onCsvLoaded={handleCsvLoaded}
            onMappingChange={setMapping}
            onClearCsv={handleClearCsv}
          />
        )}
        {step === 2 && <Step2Sequences sequence={sequence} onChange={setSequence} />}
        {step === 3 && (
          <Step3Setup
            name={name}
            onNameChange={setName}
            schedule={schedule}
            onScheduleChange={setSchedule}
            settings={settings}
            onSettingsChange={setSettings}
            startNow={startNow}
            onStartNowChange={setStartNow}
            startAt={startAt}
            onStartAtChange={setStartAt}
          />
        )}
        {step === 4 && (
          <Step4Review
            leads={leads}
            sequence={sequence}
            onRunSpamTest={() => window.alert('Spam test is not yet implemented.')}
            onSendTestEmail={() => window.alert('Send test email is not yet implemented.')}
            onStartCampaign={() => void submit(false)}
            submitting={submitting}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950/70 backdrop-blur-sm px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500 min-w-0 truncate">
          {submitError && <span className="text-red-400">Error: {submitError}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={!canAdvance(step)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
            >
              Save as Draft
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

export default CampaignWizard;
