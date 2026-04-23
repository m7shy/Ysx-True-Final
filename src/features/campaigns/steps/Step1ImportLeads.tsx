import React, { useMemo, useRef, useState } from 'react';
import { Upload, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CsvData, MappingField } from '../types';
import { MAPPING_OPTIONS, autoMap } from '../defaults';
import { parseCsv } from '../utils';

interface Step1Props {
  csv: CsvData | null;
  fileName: string | null;
  mapping: Record<string, MappingField>;
  onCsvLoaded: (csv: CsvData, fileName: string, mapping: Record<string, MappingField>) => void;
  onMappingChange: (mapping: Record<string, MappingField>) => void;
  onClearCsv: () => void;
}

export const Step1ImportLeads: React.FC<Step1Props> = ({
  csv,
  fileName,
  mapping,
  onCsvLoaded,
  onMappingChange,
  onClearCsv,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!csv) {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold text-white mb-1">Import Leads</h2>
        <p className="text-sm text-slate-400 mb-6">
          Upload a CSV file containing your leads. We'll auto-detect your columns so
          you can map them to the right fields.
        </p>

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
          className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragActive
              ? 'border-brand-500 bg-brand-500/5'
              : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
          }`}
        >
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
            <Upload className="w-6 h-6 text-brand-400" />
          </div>
          <p className="text-white font-medium mb-1">Drop your CSV here</p>
          <p className="text-sm text-slate-400 mb-4">or click to browse files</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-lg transition-colors"
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
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-white mb-1">Map CSV Fields</h2>
      <p className="text-sm text-slate-400 mb-6">
        Match each column from your CSV to the correct field. Email is required.
      </p>

      <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-brand-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{fileName}</p>
            <p className="text-xs text-slate-500">
              {csv.rows.length} lead{csv.rows.length === 1 ? '' : 's'} · {csv.headers.length} columns
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClearCsv}
          className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800"
          aria-label="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 px-4 py-3 bg-slate-900/80 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <span>CSV Column</span>
          <span className="w-4" />
          <span>Maps To</span>
        </div>
        <div className="divide-y divide-slate-800">
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
                    <p className="text-xs text-slate-500 truncate">e.g. {sample}</p>
                  )}
                </div>
                <span className="text-slate-600 text-sm">→</span>
                <select
                  value={mapping[header] ?? 'custom'}
                  onChange={(e) =>
                    onMappingChange({
                      ...mapping,
                      [header]: e.target.value as MappingField,
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
    </div>
  );
};
