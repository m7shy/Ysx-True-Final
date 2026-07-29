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
import { ConfirmModal } from '../../../components/ConfirmModal';
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
  const [confirmClose, setConfirmClose] = useState(false);

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
        // At least one active day. Un-ticking all seven produces a sendDays
        // bitmask of 0, which the send engine reads as "no day is ever a send
        // day": the campaign would sit ACTIVE forever having sent nothing,
        // with no pausedReason and nothing recording why. The server refuses
        // it too (campaigns/routes.ts rejectEmptySendDays) — this stops the
        // user reaching a 400 at the very end of a four-step wizard.
        return name.trim().length > 0 && DAY_KEYS.some((k) => schedule.sendDays[k]);
      default:
        return true;
    }
  };

  const completed = useMemo(() => {
    const done = new Set<number>();
    for (let i = 1; i < step; i++) done.add(i);
    return done;
  }, [step]);

  /**
   * Whether closing now would throw away real work. Compared against the
   * defaults rather than tracked with a dirty flag so that undoing an edit
   * correctly makes the wizard clean again.
   */
  const hasWork =
    leads.length > 0 ||
    csv !== null ||
    name !== (initialName || 'New Campaign') ||
    JSON.stringify(sequence) !== JSON.stringify(DEFAULT_SEQUENCE) ||
    JSON.stringify(schedule) !== JSON.stringify(DEFAULT_SCHEDULE) ||
    JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);

  /**
   * Close, confirming first if there is anything to lose. Both close controls
   * route through here: the wizard holds every imported lead and every
   * sequence edit in component state with no persistence, so a single misclick
   * on Close after importing 800 leads discarded all of it silently.
   */
  const requestClose = () => {
    if (hasWork) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

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
    const main = sequence[0]?.variants[0];

    // Validated BEFORE `setSubmitting(true)`, and inside the try below, because
    // `startAt` initialises to '' — so choosing "start later" and submitting
    // without picking a date threw `RangeError: Invalid time value` from
    // `new Date('').toISOString()`. That throw used to happen after
    // setSubmitting(true) and OUTSIDE the try, so the finally never ran:
    // `submitting` stayed true, both buttons stayed disabled, no error was ever
    // shown, and every imported lead and sequence step in the wizard was lost
    // with no way to recover but a reload.
    let scheduledAt: string;
    if (startNow) {
      scheduledAt = new Date().toISOString();
    } else {
      const parsed = new Date(startAt);
      if (!startAt || Number.isNaN(parsed.getTime())) {
        setSubmitError('Pick a start date and time, or choose "Start now".');
        return;
      }
      scheduledAt = parsed.toISOString();
    }

    setSubmitting(true);
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
    <div className="fixed inset-0 z-50 flex flex-col h-full bg-noir text-neutral-300">
      {/* Header */}
      <header className="border-b border-white/10 bg-noir/70 backdrop-blur-sm px-4 md:px-6 py-4 flex items-center gap-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-volt-text rounded-xl px-2 py-1 -ml-2 w-64"
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
        <button type="button" onClick={requestClose} className="text-sm text-neutral-400 hover:text-white transition-colors">
          Close
        </button>
      </header>

      <ConfirmModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={onClose}
        title="Discard this campaign?"
        message="Your imported leads, sequence and schedule are not saved anywhere yet. Closing now loses all of it. Use Save as Draft on the final step to keep it."
        confirmText="Discard"
        cancelText="Keep editing"
        isDanger
      />

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
            crmSelected={crmLeads}
            onCrmSelectedChange={setCrmLeads}
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
      <footer className="border-t border-white/10 bg-noir/70 backdrop-blur-sm px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-neutral-500 min-w-0 truncate">
          {submitError && <span className="text-red-400">Error: {submitError}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-neutral-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/16 disabled:opacity-40 disabled:cursor-not-allowed rounded-full transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={!canAdvance(step)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)] disabled:opacity-40 disabled:cursor-not-allowed rounded-full transition-all"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-neutral-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/16 disabled:opacity-40 disabled:cursor-not-allowed rounded-full transition-all"
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
