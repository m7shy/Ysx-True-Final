import React from 'react';
import { CalendarClock, SlidersHorizontal, ShieldCheck, AlertTriangle } from 'lucide-react';
import { CampaignSettings, ScheduleConfig } from '../types';
import { TIMEZONE_OPTIONS } from '../defaults';

interface Step3Props {
  name: string;
  onNameChange: (name: string) => void;
  schedule: ScheduleConfig;
  onScheduleChange: (s: ScheduleConfig) => void;
  settings: CampaignSettings;
  onSettingsChange: (s: CampaignSettings) => void;
  startNow: boolean;
  onStartNowChange: (v: boolean) => void;
  startAt: string; // datetime-local value, used when startNow is false
  onStartAtChange: (v: string) => void;
}

type DayKey = keyof ScheduleConfig['sendDays'];
const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

export const Step3Setup: React.FC<Step3Props> = ({
  name,
  onNameChange,
  schedule,
  onScheduleChange,
  settings,
  onSettingsChange,
  startNow,
  onStartNowChange,
  startAt,
  onStartAtChange,
}) => {
  const toggleDay = (key: DayKey) => {
    onScheduleChange({
      ...schedule,
      sendDays: { ...schedule.sendDays, [key]: !schedule.sendDays[key] },
    });
  };

  const Toggle = ({
    checked,
    onChange,
    label,
    hint,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    hint?: string;
  }) => (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${
          checked ? 'bg-volt' : 'bg-white/10'
        }`}
        aria-pressed={checked}
        aria-label={label}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Campaign name */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
          Campaign Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full md:w-96 bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
        />
      </section>

      {/* 1. Schedule configuration */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-volt-text" />
          <h3 className="text-sm font-semibold text-white">Schedule Configuration</h3>
        </header>
        <div className="p-5 space-y-5">
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="radio"
                checked={startNow}
                onChange={() => onStartNowChange(true)}
                className="w-4 h-4 text-volt focus:ring-volt-text"
              />
              Start now
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="radio"
                checked={!startNow}
                onChange={() => onStartNowChange(false)}
                className="w-4 h-4 text-volt focus:ring-volt-text"
              />
              Schedule for later
            </label>
            {!startNow && (
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => onStartAtChange(e.target.value)}
                className="bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
              Timezone
            </label>
            <select
              value={schedule.timezone}
              onChange={(e) => onScheduleChange({ ...schedule, timezone: e.target.value })}
              className="w-full md:w-80 bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
              Active Days
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const on = schedule.sendDays[d.key];
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                      on
                        ? 'bg-volt border-volt-text/40 text-white'
                        : 'bg-white/[0.03] border-white/10 text-neutral-400 hover:border-white/16'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                Send Window Start
              </label>
              <input
                type="time"
                value={schedule.startTime}
                onChange={(e) => onScheduleChange({ ...schedule, startTime: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                Send Window End
              </label>
              <input
                type="time"
                value={schedule.endTime}
                onChange={(e) => onScheduleChange({ ...schedule, endTime: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                Send Interval (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                value={schedule.intervalMinutes}
                onChange={(e) =>
                  onScheduleChange({
                    ...schedule,
                    intervalMinutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)),
                  })
                }
                className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                ±30–60s of random jitter is added automatically between sends for natural pacing.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                Daily Send Limit
              </label>
              <input
                type="number"
                min={1}
                value={schedule.maxNewLeadsPerDay}
                onChange={(e) =>
                  onScheduleChange({
                    ...schedule,
                    maxNewLeadsPerDay: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Campaign behavior */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-volt-text" />
          <h3 className="text-sm font-semibold text-white">Campaign Behavior</h3>
        </header>
        <div className="p-5 divide-y divide-white/10">
          <Toggle
            checked={settings.stopOnReply}
            onChange={(v) => onSettingsChange({ ...settings, stopOnReply: v })}
            label="Stop campaign when lead replies"
            hint="Recommended — best for engagement."
          />
          <Toggle
            checked={settings.stopOnClick}
            onChange={(v) => onSettingsChange({ ...settings, stopOnClick: v })}
            label="Stop campaign when lead clicks"
          />
          <Toggle
            checked={settings.stopOnOpen}
            onChange={(v) => onSettingsChange({ ...settings, stopOnOpen: v })}
            label="Stop campaign when lead opens"
          />
          <div className="py-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium text-white">Follow-up priority</p>
              <span className="text-xs text-neutral-400">
                {settings.followUpPercent}% follow-ups / {100 - settings.followUpPercent}% new leads
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.followUpPercent}
              onChange={(e) => onSettingsChange({ ...settings, followUpPercent: Number(e.target.value) })}
              className="w-full accent-volt"
            />
            <div className="flex justify-between text-xs text-neutral-500 mt-1">
              <span>New leads first</span>
              <span>Follow-ups first</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Delivery optimization */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-volt-text" />
          <h3 className="text-sm font-semibold text-white">Delivery Optimization</h3>
        </header>
        <div className="p-5 divide-y divide-white/10">
          <Toggle
            checked={settings.plainTextMode}
            onChange={(v) => onSettingsChange({ ...settings, plainTextMode: v })}
            label="Plain text mode"
            hint="Improves deliverability, but disables open tracking (the open pixel requires HTML)."
          />
          {settings.plainTextMode && settings.stopOnOpen && (
            <div className="flex items-start gap-2 py-3 text-xs text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Plain text mode disables open tracking — "stop on open" will never trigger.
            </div>
          )}
          <div className="py-3 text-sm text-neutral-400">
            Tracking: opens + link clicks are always on.
          </div>
          <div className="py-3 text-sm text-neutral-400">
            Domain-level rate limiting: campaign auto-pauses if the bounce rate reaches 5%.
          </div>
        </div>
      </section>
    </div>
  );
};
