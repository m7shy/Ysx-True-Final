import React from 'react';
import { Users, Plus, Upload, Download, Search, Zap } from 'lucide-react';
import { Button } from '../../src/design/ui';
import { AnimatedHeading } from '../motion/primitives';

export interface LeadsToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showRunRemaining: boolean;
  isBulkAnalyzing: boolean;
  onBulkAnalyze: () => void;
  isImporting: boolean;
  onImportClick: () => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImportFile: (files: FileList | null) => void;
  isExporting: boolean;
  onExport: () => void;
  onAddLead: () => void;
}

export const LeadsToolbar: React.FC<LeadsToolbarProps> = ({
  searchQuery,
  onSearchChange,
  showRunRemaining,
  isBulkAnalyzing,
  onBulkAnalyze,
  isImporting,
  onImportClick,
  importInputRef,
  onImportFile,
  isExporting,
  onExport,
  onAddLead,
}) => {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <AnimatedHeading as="h2" className="text-2xl font-semibold text-white flex items-center tracking-tight">
            <Users className="w-6 h-6 mr-2 text-volt-text" />
            Lead Management
          </AnimatedHeading>
        </div>

        <div className="flex flex-wrap gap-2 md:gap-3">
          {showRunRemaining && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkAnalyze}
              loading={isBulkAnalyzing}
              leftIcon={<Zap className="w-4 h-4" />}
            >
              <span className="hidden sm:inline">Run Remaining</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onImportClick}
            disabled={isImporting}
            loading={isImporting}
            leftIcon={<Upload className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">Import</span>
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => onImportFile(e.target.files)}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onExport}
            disabled={isExporting}
            loading={isExporting}
            leftIcon={<Download className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">Export</span>
          </Button>
          <Button
            size="sm"
            onClick={onAddLead}
            leftIcon={<Plus className="w-4 h-4" />}
            className="flex-1 md:flex-none"
          >
            Add Lead
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 relative max-w-md">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-neutral-500" />
        </div>
        <input
          type="text"
          placeholder="Search (e.g. 'John Acme')..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search leads"
          className="block w-full pl-10 pr-4 py-2.5 border border-white/10 rounded-xl bg-white/[0.03] text-white placeholder:text-neutral-500 focus:outline-none focus:border-volt-text sm:text-sm transition-colors duration-300"
        />
      </div>
    </>
  );
};
