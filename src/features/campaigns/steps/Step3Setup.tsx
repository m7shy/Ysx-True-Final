import React, { useEffect, useState } from 'react';
import { Mail, ShieldCheck, BarChart3, AlertCircle } from 'lucide-react';
import { CampaignSettings, ScheduleConfig, SenderAccount } from '../types';
import { TIMEZONE_OPTIONS } from '../defaults';

interface Step3Props {
  selectedSenderIds: string[];
  onSenderIdsChange: (ids: string[]) => void;
  schedule: ScheduleConfig;
  onScheduleChange: (s: ScheduleConfig) => void;
  settings: CampaignSettings;
  onSettingsChange: (s: CampaignSettings) => void;
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
  selectedSenderIds,
  onSenderIdsChange,
  schedule,
  onScheduleChange,
  settings,
  onSettingsChange,
}) => {
  const [accounts, setAccounts] = useState<SenderAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/campaigns/sender-accounts');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { accounts: SenderAccount[] };
        if (!cancelled) setAccounts(data.accounts);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setLoadError('Could not load sender accounts.');
          setAccounts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSender = (id: string) => {
    onSenderIdsChange(
      selectedSenderIds.includes(id)
        ? selectedSenderIds.filter((x) => x !== id)
        : [...selectedSenderIds, id]
    );
  };

  const toggleDay = (key: DayKey) => {
    onScheduleChange({
      ...schedule,
      sendDays: { ...schedule.sendDays, [key]: !schedule.sendDays[key] },
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Sender Accounts */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40">
        <header className="px-5 py-4 border-b border-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-white">Sender Accounts</h3>
        </header>
        <div className="p-5">
          {accounts === null ? (
            <p className="text-sm text-slate-500">Loading connected mailboxes…</p>
          ) : accounts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <AlertCircle className="w-4 h-4" />
              {loadError ?? 'No connected mailboxes. Connect one in Integrations first.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {accounts.map((a) => {
                const checked = selectedSenderIds.includes(a.id);
                return (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSender(a.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-950 text-brand-600 focus:ring-brand-500"
                    />
                    <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                      <Mail className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {a.email}
                      </p>
                      <p className="text-xs text-slate-500 capitalize">{a.provider}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-6 text-xs">
                      <div className="text-center">
                        <div className="flex items-center gap-1 text-slate-400">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Warmup</span>
                        </div>
                        <p className="text-white font-semibold mt-0.5">
                          {a.warmupReputation}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-400">Daily limit</p>
                        <p className="text-white font-semibold mt-0.5">{a.dailyLimit}</p>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center gap-1 text-slate-400">
                          <BarChart3 className="w-3.5 h-3.5" />
                          <span>Used by</span>
                        </div>
                        <p className="text-white font-semibold mt-0.5">
                          {a.campaignsUsed}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Schedule */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40">
        <header className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">Schedule Campaign</h3>
        </header>
        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Timezone
            </label>
            <select
              value={schedule.timezone}
              onChange={(e) =>
                onScheduleChange({ ...schedule, timezone: e.target.value })
              }
              className="w-full md:w-80 bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Send Days
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const on = schedule.sendDays[d.key];
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      on
                        ? 'bg-brand-600 border-brand-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
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
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Start Time
              </label>
              <input
                type="time"
                value={schedule.startTime}
                onChange={(e) =>
                  onScheduleChange({ ...schedule, startTime: e.target.value })
                }
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                End Time
              </label>
              <input
                type="time"
                value={schedule.endTime}
                onChange={(e) =>
                  onScheduleChange({ ...schedule, endTime: e.target.value })
                }
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Interval Between Emails (minutes)
              </label>
              <input
                type="number"
                min={1}
                value={schedule.intervalMinutes}
                onChange={(e) =>
                  onScheduleChange({
                    ...schedule,
                    intervalMinutes: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Max New Leads / Day
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
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Campaign Settings */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40">
        <header className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">Campaign Settings</h3>
        </header>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                {settings.followUpPercent}% Follow up leads
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Include the follow-up sequence for matching leads.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  followUpPercent: settings.followUpPercent > 0 ? 0 : 100,
                })
              }
              className={`w-11 h-6 rounded-full relative transition-colors ${
                settings.followUpPercent > 0 ? 'bg-brand-600' : 'bg-slate-700'
              }`}
              aria-pressed={settings.followUpPercent > 0}
              aria-label="Toggle follow up leads"
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${
                  settings.followUpPercent > 0 ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
