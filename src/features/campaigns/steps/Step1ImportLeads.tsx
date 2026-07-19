import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileText, X, AlertCircle, CheckCircle2, Users, Search, Loader2 } from 'lucide-react';
import { CsvData, MappingField, Lead as WizardLead } from '../types';
import { MAPPING_OPTIONS, autoMap } from '../defaults';
import { parseCsv } from '../utils';
import { fetchLeads } from '../../../../services/leadsApi';
import type { Lead as CrmLead } from '../../../../types';

interface Step1Props {
  csv: CsvData | null;
  fileName: string | null;
  mapping: Record<string, MappingField>;
  onCsvLoaded: (csv: CsvData, fileName: string, mapping: Record<string, MappingField>) => void;
  onMappingChange: (mapping: Record<string, MappingField>) => void;
  onClearCsv: () => void;
  crmSelected: WizardLead[];
  onCrmSelectedChange: (leads: WizardLead[]) => void;
}

function crmToWizardLead(lead: CrmLead): WizardLead {
  const parts = (lead.name ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    email: lead.email,
    first_name: parts[0],
    last_name: parts.slice(1).join(' ') || undefined,
    company: lead.company || undefined,
    custom: {},
  };
}

export const Step1ImportLeads: React.FC<Step1Props> = ({
  csv,
  fileName,
  mapping,
  onCsvLoaded,
  onMappingChange,
  onClearCsv,
  crmSelected,
  onCrmSelectedChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'csv' | 'crm'>(crmSelected.length > 0 && !csv ? 'crm' : 'csv');

  // CRM tab state
  const [crmLeads, setCrmLeads] = useState<CrmLead[] | null>(null);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (tab !== 'crm' || crmLeads !== null) return;
    let cancelled = false;
    fetchLeads()
      .then((leads) => {
        if (!cancelled) setCrmLeads(leads);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setCrmError('Failed to load your CRM leads. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, crmLeads]);

  const selectedEmails = useMemo(
    () => new Set(crmSelected.map((l) => l.email.toLowerCase())),
    [crmSelected],
  );

  const filteredCrm = useMemo(() => {
    if (!crmLeads) return [];
    const q = query.trim().toLowerCase();
    if (!q) return crmLeads;
    return crmLeads.filter(
      (l) =>
        l.email.toLowerCase().includes(q) ||
        (l.name ?? '').toLowerCase().includes(q) ||
        (l.company ?? '').toLowerCase().includes(q),
    );
  }, [crmLeads, query]);

  const toggleLead = (lead: CrmLead) => {
    const key = lead.email.toLowerCase();
    if (selectedEmails.has(key)) {
      onCrmSelectedChange(crmSelected.filter((l) => l.email.toLowerCase() !== key));
    } else {
      onCrmSelectedChange([...crmSelected, crmToWizardLead(lead)]);
    }
  };

  const allFilteredSelected =
    filteredCrm.length > 0 && filteredCrm.every((l) => selectedEmails.has(l.email.toLowerCase()));

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredEmails = new Set(filteredCrm.map((l) => l.email.toLowerCase()));
      onCrmSelectedChange(crmSelected.filter((l) => !filteredEmails.has(l.email.toLowerCase())));
    } else {
      const additions = filteredCrm
        .filter((l) => !selectedEmails.has(l.email.toLowerCase()))
        .map(crmToWizardLead);
      onCrmSelectedChange([...crmSelected, ...additions]);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!/\.csv$/i.test(file.name)) {
      setError('Please upload a .csv file.');
      return;
    }
    try {
      const text = await file.text();
      const data = parseCsv(text);
      if (data.headers.length === 0 || data.rows.length === 0) {
        setError('The CSV file appears to be empty.');
        return;
      }
      const auto: Record<string, MappingField> = {};
      for (const h of data.headers) auto[h] = autoMap(h);
      onCsvLoaded(data, file.name, auto);
    } catch (err) {
      console.error(err);
      setError('Failed to read the CSV file.');
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void handleFiles(e.dataTransfer?.files ?? null);
  };

  const emailMapped = useMemo(() => {
    if (!csv) return false;
    return csv.headers.some((h) => mapping[h] === 'email');
  }, [csv, mapping]);

  const tabButton = (id: 'csv' | 'crm', icon: React.ReactNode, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
        tab === id
          ? 'bg-volt/15 text-volt-text border border-volt-text/40'
          : 'text-neutral-400 hover:text-white border border-transparent hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1 px-1.5 py-0.5 text-[11px] font-semibold rounded-full bg-volt text-white">
          {count}
        </span>
      )}
    </button>
  );

  const crmTab = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or company…"
            className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-volt-text transition-colors placeholder:text-neutral-500"
          />
        </div>
        {crmLeads && filteredCrm.length > 0 && (
          <button
            type="button"
            onClick={toggleAllFiltered}
            className="text-xs font-semibold text-volt-text hover:text-white whitespace-nowrap transition-colors"
          >
            {allFilteredSelected ? 'Deselect all' : `Select all (${filteredCrm.length})`}
          </button>
        )}
      </div>

      {crmError ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />
          {crmError}
        </div>
      ) : !crmLeads ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your leads…
        </div>
      ) : crmLeads.length === 0 ? (
        <div className="py-10 text-center text-sm text-neutral-400">
          No leads in your CRM yet. Import some from the Leads view or the Scraper, or use the CSV
          tab.
        </div>
      ) : filteredCrm.length === 0 ? (
        <div className="py-10 text-center text-sm text-neutral-400">No leads match your search.</div>
      ) : (
        <div className="divide-y divide-white/10 max-h-[380px] overflow-y-auto">
          {filteredCrm.map((lead) => {
            const checked = selectedEmails.has(lead.email.toLowerCase());
            return (
              <label
                key={lead.id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleLead(lead)}
                  className="w-4 h-4 rounded border-white/20 bg-white/[0.03] text-volt focus:ring-volt-text focus:ring-offset-noir"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">
                    {lead.name || lead.email}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">
                    {lead.email}
                    {lead.company ? ` · ${lead.company}` : ''}
                  </p>
                </div>
                <span className="text-[11px] uppercase tracking-wider text-neutral-500 flex-shrink-0">
                  {lead.status}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  const csvTab = !csv ? (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
      }}
      onDrop={handleDrop}
      className={`rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
        dragActive
          ? 'border-volt-text bg-volt/5'
          : 'border-white/10 bg-white/[0.02] hover:border-white/16'
      }`}
    >
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/[0.06] flex items-center justify-center">
        <Upload className="w-6 h-6 text-volt-text" />
      </div>
      <p className="text-white font-medium mb-1">Drop your CSV here</p>
      <p className="text-sm text-neutral-400 mb-4">or click to browse files</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center px-4 py-2 bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)] text-white text-sm font-semibold rounded-full transition-all"
      >
        <Upload className="w-4 h-4 mr-2" />
        Select CSV File
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {error && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between bg-white/[0.02] border border-white/10 rounded-2xl px-4 py-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-volt-text" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{fileName}</p>
            <p className="text-xs text-neutral-500">
              {csv.rows.length} lead{csv.rows.length === 1 ? '' : 's'} · {csv.headers.length} columns
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClearCsv}
          className="text-neutral-400 hover:text-white p-2 rounded-full hover:bg-white/[0.06] transition-colors"
          aria-label="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 px-4 py-3 bg-white/[0.02] border-b border-white/10 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          <span>CSV Column</span>
          <span className="w-4" />
          <span>Maps To</span>
        </div>
        <div className="divide-y divide-white/10">
          {csv.headers.map((header) => {
            const sample = csv.rows[0]?.[csv.headers.indexOf(header)] ?? '';
            return (
              <div
                key={header}
                className="grid grid-cols-[1fr_auto_1fr] gap-4 px-4 py-3 items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{header}</p>
                  {sample && (
                    <p className="text-xs text-neutral-500 truncate">e.g. {sample}</p>
                  )}
                </div>
                <span className="text-neutral-500 text-sm">→</span>
                <select
                  value={mapping[header] ?? 'custom'}
                  onChange={(e) =>
                    onMappingChange({
                      ...mapping,
                      [header]: e.target.value as MappingField,
                    })
                  }
                  className="w-full bg-white/[0.03] border border-white/10 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-volt-text transition-colors"
                >
                  {MAPPING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`mt-4 flex items-center gap-2 text-sm ${
          emailMapped ? 'text-emerald-400' : 'text-amber-400'
        }`}
      >
        {emailMapped ? (
          <>
            <CheckCircle2 className="w-4 h-4" />
            Email column detected. You can proceed.
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4" />
            Map one of your columns to <span className="font-semibold">Email</span> to continue.
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-white mb-1">Import Leads</h2>
      <p className="text-sm text-neutral-400 mb-4">
        Upload a CSV, pick leads already in your CRM, or combine both.
      </p>

      <div className="flex items-center gap-2 mb-5">
        {tabButton('csv', <Upload className="w-4 h-4" />, 'Upload CSV', csv?.rows.length)}
        {tabButton('crm', <Users className="w-4 h-4" />, 'From CRM', crmSelected.length)}
      </div>

      {tab === 'csv' ? csvTab : crmTab}
    </div>
  );
};
