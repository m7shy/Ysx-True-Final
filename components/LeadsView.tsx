import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Zap, Rocket, Trophy, Check, Copy, Radar } from 'lucide-react';
import { Lead, LeadStatus, OfferFitAnalysis } from '../types';
import {
  fetchLeads,
  addLead,
  updateLeadStatus,
  updateLeadNotes,
  updateLeadScore,
  deleteLead,
  importLeadsCsv,
  exportLeadsCsv,
} from '../services/leadsApi';
import { analyzeOfferFit, scoreLead } from '../services/gemini';
import { useNotification } from '../context/NotificationContext';
import { ConfirmModal } from './ConfirmModal';
import { EASE, MaskedReveal } from './motion/primitives';
import { Button, Input, Select, Textarea, Alert } from '../src/design/ui';
import { LeadsToolbar } from './leads/LeadsToolbar';
import { LeadsTable } from './leads/LeadsTable';

interface LeadsViewProps {
  onCompose: (lead: Lead) => void;
}

export const LeadsView: React.FC<LeadsViewProps> = ({ onCompose }) => {
  const { showToast } = useNotification();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', email: '', company: '', source: 'Direct' });

  const [actionLoading, setActionLoading] = useState<string | null>(null); // ID of loading item (delete/status)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Matches the actionLoading-style discipline used by every other mutating action
  // in this file — set for the duration of the request, cleared in finally.
  const [isAddingLead, setIsAddingLead] = useState(false);

  // Scanner State
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [selectedLeadForScan, setSelectedLeadForScan] = useState<Lead | null>(null);
  const [scanContext, setScanContext] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<OfferFitAnalysis | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Modal State
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isMounted = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMounted.current = true;
    loadLeads();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadLeads = async () => {
    if (isMounted.current) setLoading(true);
    try {
      const data = await fetchLeads();
      if (isMounted.current) {
        setLeads(data);
      }
    } catch(e) {
      console.error(e);
      showToast('ERROR', "Failed to load leads.");
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLead.name || !newLead.email) return;

    setIsAddingLead(true);
    try {
      const added = await addLead({
        name: newLead.name,
        email: newLead.email,
        company: newLead.company,
        source: newLead.source,
        status: 'NEW' as LeadStatus,
        lastContacted: null,
        notes: '',
      });
      if (isMounted.current) {
        setLeads([added, ...leads]);
        setIsAddModalOpen(false);
        setNewLead({ name: '', email: '', company: '', source: 'Direct' });
        showToast('SUCCESS', "Lead added successfully.");
      }
    } catch (error: any) {
      console.error("Failed to add lead", error);
      showToast('ERROR', error?.message ?? "Failed to add lead. Please try again.");
    } finally {
      // Always clear, even on error, so the button doesn't stay permanently disabled.
      if (isMounted.current) setIsAddingLead(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: LeadStatus) => {
    setActionLoading(id);
    try {
      await updateLeadStatus(id, newStatus);
      if (isMounted.current) {
        setLeads(leads.map(l => l.id === id ? { ...l, status: newStatus } : l));
      }
    } catch (error) {
      console.error("Failed to update status", error);
      showToast('ERROR', "Failed to update lead status.");
    } finally {
      if (isMounted.current) setActionLoading(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(deleteId);
    try {
      await deleteLead(deleteId);
      if (isMounted.current) {
        setLeads(leads.filter(l => l.id !== deleteId));
        showToast('SUCCESS', "Lead deleted successfully.");
      }
    } catch (error) {
      console.error("Failed to delete lead", error);
      showToast('ERROR', "Failed to delete lead.");
    } finally {
      if (isMounted.current) {
        setActionLoading(null);
        setDeleteId(null);
      }
    }
  };

  /** AI fit score from the lead's real CRM data, persisted via /api/leads. */
  const analyzeOne = async (lead: Lead): Promise<Lead | null> => {
    const result = await scoreLead({
      name: lead.name,
      email: lead.email,
      company: lead.company,
      source: lead.source,
      notes: lead.notes,
      intelligence: lead.intelligence,
    });
    if (!result) return null;
    return updateLeadScore(lead.id, result.score, {
      ...(lead.intelligence ?? {}),
      scoreReasoning: result.reasoning,
      scoredAt: new Date().toISOString(),
    });
  };

  const handleAnalyze = async (id: string) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    setAnalyzingIds(prev => new Set(prev).add(id));
    try {
      const updatedLead = await analyzeOne(lead);
      if (!updatedLead) throw new Error('Analysis returned no result');
      if (isMounted.current) {
        setLeads(prev => prev.map(l => l.id === id ? updatedLead : l));
        showToast('SUCCESS', "Lead analyzed successfully.");
      }
    } catch (error) {
      console.error("Failed to analyze lead", error);
      showToast('ERROR', "Analysis failed. Please try again.");
    } finally {
      if (isMounted.current) {
        setAnalyzingIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }
    }
  };

  const handleBulkAnalyze = async () => {
    const leadsToAnalyze = leads.filter(l => l.score === undefined);
    if (leadsToAnalyze.length === 0) return;

    setIsBulkAnalyzing(true);
    try {
      const results = await Promise.all(leadsToAnalyze.map(l => analyzeOne(l).catch(() => null)));
      const succeeded = results.filter((l): l is Lead => l !== null);

      if (isMounted.current) {
        setLeads(prevLeads => {
          const updatedMap = new Map(succeeded.map(l => [l.id, l]));
          return prevLeads.map(l => updatedMap.get(l.id) || l);
        });
        if (succeeded.length === results.length) {
          showToast('SUCCESS', `Analyzed ${succeeded.length} leads successfully.`);
        } else {
          showToast('ERROR', `Analyzed ${succeeded.length}/${results.length} leads — some failed.`);
        }
      }
    } catch (error) {
      console.error("Bulk analysis failed", error);
      showToast('ERROR', "Bulk analysis failed. Check logs.");
    } finally {
      if (isMounted.current) setIsBulkAnalyzing(false);
    }
  };

  const handleOpenScan = (lead: Lead) => {
    setSelectedLeadForScan(lead);
    setScanContext('');
    setScanResult(null);
    setIsScanModalOpen(true);
  };

  const handleRunScan = async () => {
    if (!scanContext.trim()) return;
    setIsScanning(true);
    try {
      const result = await analyzeOfferFit(scanContext);
      if (isMounted.current) setScanResult(result);
    } catch (error) {
      console.error("Scan failed", error);
      showToast('ERROR', "Scan failed. Please verify input.");
    } finally {
      if (isMounted.current) setIsScanning(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLeadForScan || !scanResult) return;
    setIsSavingNote(true);
    try {
      const currentNotes = selectedLeadForScan.notes || '';
      const newNotes = `${currentNotes ? currentNotes + '\n\n' : ''}--- AI FIT SCAN ---\nProduct: ${scanResult.product}\nMaturity: ${scanResult.maturity}\nScore: ${scanResult.score}/100\nPitch Angle: ${scanResult.angle}`;

      await updateLeadNotes(selectedLeadForScan.id, newNotes);

      if (isMounted.current) {
        setLeads(prev => prev.map(l => l.id === selectedLeadForScan.id ? { ...l, notes: newNotes } : l));
        setIsScanModalOpen(false);
        showToast('SUCCESS', "Notes updated successfully.");
      }
    } catch (error) {
      console.error("Failed to save notes", error);
      showToast('ERROR', "Failed to save notes.");
    } finally {
      if (isMounted.current) setIsSavingNote(false);
    }
  };

  const handleImportFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const result = await importLeadsCsv(file);
      showToast('SUCCESS', `Import complete: ${result.created} new, ${result.updated} updated, ${result.skipped} skipped.`);
      await loadLeads();
    } catch (error: any) {
      console.error("Import failed", error);
      showToast('ERROR', error?.message ?? "Import failed. Check the CSV format (header row with name,email,...).");
    } finally {
      if (isMounted.current) setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportLeadsCsv();
    } catch (error: any) {
      console.error("Export failed", error);
      showToast('ERROR', error?.message ?? "Export failed.");
    } finally {
      if (isMounted.current) setIsExporting(false);
    }
  };

  // Enhanced multi-term search
  const filteredLeads = leads.filter(l => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    const terms = query.split(/\s+/);
    return terms.every(term =>
      l.name.toLowerCase().includes(term) ||
      (l.company || '').toLowerCase().includes(term) ||
      l.email.toLowerCase().includes(term) ||
      (l.source || '').toLowerCase().includes(term)
    );
  });

  const scoredLeads = leads.filter(l => l.score !== undefined);
  const topLeads = [...scoredLeads].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  const hasScores = scoredLeads.length > 0;

  return (
    <div className="p-4 md:p-8 h-full flex flex-col overflow-y-auto custom-scrollbar">
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete Lead?"
        message="Are you sure you want to delete this lead? This action cannot be undone."
        confirmText="Delete"
        isDanger={true}
      />

      {/* Top Section: Intelligence Dashboard */}
      <div className="mb-8">
         {hasScores ? (
           <MaskedReveal className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-white relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-volt/10 rounded-full translate-x-1/3 -translate-y-1/3 blur-3xl" />

             <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center">
                   <Trophy className="w-6 h-6 text-amber-400 mr-3" />
                   <div>
                     <h3 className="text-lg font-semibold">Today's Big 10</h3>
                     <p className="text-neutral-400 text-sm">Highest scoring prospects based on engagement & fit.</p>
                   </div>
                </div>
                <div className="text-right hidden md:block">
                   <div className="text-2xl font-semibold text-volt-text">{Math.round(scoredLeads.reduce((acc, l) => acc + (l.score || 0), 0) / scoredLeads.length)}</div>
                   <div className="text-xs text-neutral-500 uppercase tracking-wider">Avg Score</div>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 relative z-10">
                {topLeads.slice(0, 3).map((lead, i) => (
                  <button key={lead.id} type="button" aria-label={`Compose email to ${lead.name}`} className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] transition-colors duration-300 p-3 rounded-2xl border border-white/10 flex items-center justify-between group" onClick={() => onCompose(lead)}>
                     <div className="flex items-center min-w-0">
                        <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold mr-3 ${i === 0 ? 'bg-amber-500 text-amber-950' : i === 1 ? 'bg-neutral-300 text-neutral-900' : 'bg-amber-700 text-amber-100'}`}>
                           {i + 1}
                        </div>
                        <div className="min-w-0">
                           <div className="text-sm font-medium group-hover:text-volt-text transition-colors duration-300 truncate">{lead.name}</div>
                           <div className="text-xs text-neutral-400 truncate">{lead.company}</div>
                        </div>
                     </div>
                     <div className="text-lg font-semibold text-emerald-400 ml-2">{lead.score}</div>
                  </button>
                ))}
             </div>
           </MaskedReveal>
         ) : (
            <MaskedReveal className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex flex-col md:flex-row items-center justify-between gap-4">
               <div className="flex items-center text-center md:text-left flex-col md:flex-row">
                  <div className="w-12 h-12 bg-volt/10 border border-volt-text/25 rounded-full flex items-center justify-center md:mr-4 mb-2 md:mb-0">
                     <Rocket className="w-6 h-6 text-volt-text" />
                  </div>
                  <div>
                     <h3 className="text-lg font-semibold text-white">Unlock Lead Intelligence</h3>
                     <p className="text-neutral-400 text-sm">Run intelligence to identify top prospects and score leads automatically.</p>
                  </div>
               </div>
               <Button
                  onClick={handleBulkAnalyze}
                  disabled={leads.length === 0}
                  loading={isBulkAnalyzing}
                  leftIcon={<Zap className="w-5 h-5" />}
                  className="w-full md:w-auto whitespace-nowrap"
               >
                  {isBulkAnalyzing ? 'Analyzing...' : 'Run Intelligence on All Leads'}
               </Button>
            </MaskedReveal>
         )}
      </div>

      <LeadsToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showRunRemaining={hasScores && leads.some(l => l.score === undefined)}
        isBulkAnalyzing={isBulkAnalyzing}
        onBulkAnalyze={handleBulkAnalyze}
        isImporting={isImporting}
        onImportClick={() => importInputRef.current?.click()}
        importInputRef={importInputRef}
        onImportFile={handleImportFile}
        isExporting={isExporting}
        onExport={handleExport}
        onAddLead={() => setIsAddModalOpen(true)}
      />

      <LeadsTable
        leads={filteredLeads}
        loading={loading}
        analyzingIds={analyzingIds}
        actionLoading={actionLoading}
        onAnalyze={handleAnalyze}
        onStatusChange={handleStatusChange}
        onScan={handleOpenScan}
        onCompose={onCompose}
        onDelete={setDeleteId}
      />

      {/* Add Lead Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center">
               <h3 className="font-semibold text-lg text-white">Add New Lead</h3>
               <button onClick={() => setIsAddModalOpen(false)} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors duration-300">
                  <X className="w-5 h-5" />
               </button>
            </div>
            <form onSubmit={handleAddLead} className="p-6 space-y-4">
               <Input
                  label="Full Name"
                  type="text"
                  required
                  value={newLead.name}
                  onChange={e => setNewLead({...newLead, name: e.target.value})}
               />
               <Input
                  label="Email Address"
                  type="email"
                  required
                  value={newLead.email}
                  onChange={e => setNewLead({...newLead, email: e.target.value})}
               />
               <Input
                  label="Company"
                  type="text"
                  value={newLead.company}
                  onChange={e => setNewLead({...newLead, company: e.target.value})}
               />
               <Select
                  label="Source"
                  value={newLead.source}
                  onChange={e => setNewLead({...newLead, source: e.target.value})}
               >
                 <option>Direct</option>
                 <option>LinkedIn</option>
                 <option>Website</option>
                 <option>Referral</option>
                 <option>Event</option>
               </Select>
               <Button type="submit" fullWidth loading={isAddingLead} disabled={isAddingLead} className="mt-2">
                  Add Lead
               </Button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Offer Fit Scanner Modal */}
      {isScanModalOpen && selectedLeadForScan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <motion.div
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             transition={{ duration: 0.2, ease: EASE }}
             className="rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
           >
              <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/[0.03]">
                 <div className="flex items-center">
                    <Radar className="w-5 h-5 text-volt-text mr-2" />
                    <div>
                       <h3 className="font-semibold text-lg text-white">Scan Lead Fit</h3>
                       <p className="text-xs text-neutral-400">Analyzing for: <span className="font-medium">{selectedLeadForScan.name}</span></p>
                    </div>
                 </div>
                 <button onClick={() => setIsScanModalOpen(false)} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors duration-300">
                    <X className="w-5 h-5" />
                 </button>
              </div>

              <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                 {!scanResult ? (
                    <div className="space-y-4 h-full flex flex-col">
                       <Alert variant="info" className="mb-2">
                          Paste their Twitter/LinkedIn bio, About page text, or recent content below. Gemini will analyze if they're a good fit for high-ticket video editing.
                       </Alert>
                       <div className="flex-1">
                          <Textarea
                             value={scanContext}
                             onChange={(e) => setScanContext(e.target.value)}
                             placeholder="Paste Profile URL, Bio, or About Page text here..."
                             aria-label="Scan context"
                             className="h-48 resize-none"
                          />
                       </div>
                       <Button
                          onClick={handleRunScan}
                          disabled={!scanContext.trim()}
                          loading={isScanning}
                          fullWidth
                          leftIcon={<Rocket className="w-5 h-5" />}
                       >
                          {isScanning ? 'Analyzing Fit...' : 'Run Analysis'}
                       </Button>
                    </div>
                 ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="space-y-6"
                    >
                       {/* Result Header */}
                       <div className="flex items-center justify-between bg-white/[0.03] p-4 rounded-2xl border border-white/10">
                          <div className="text-center">
                             <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Fit Score</div>
                             <div className={`text-4xl font-semibold ${
                                scanResult.score >= 80 ? 'text-green-400' :
                                scanResult.score >= 50 ? 'text-amber-400' : 'text-red-400'
                             }`}>
                                {scanResult.score}
                             </div>
                          </div>
                          <div className="h-10 w-px bg-white/10" />
                          <div className="text-center">
                             <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Maturity</div>
                             <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                                scanResult.maturity === 'Pro' ? 'bg-purple-500/15 text-purple-300 border-purple-500/25' :
                                scanResult.maturity === 'Mid' ? 'bg-blue-500/15 text-blue-300 border-blue-500/25' :
                                'bg-white/[0.06] text-neutral-400 border-white/10'
                             }`}>
                                {scanResult.maturity}
                             </span>
                          </div>
                          <div className="h-10 w-px bg-white/10" />
                          <div className="text-center">
                             <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Offer</div>
                             <div className="text-sm font-semibold text-white max-w-[100px] truncate" title={scanResult.product}>
                                {scanResult.product}
                             </div>
                          </div>
                       </div>

                       {/* Pitch Angle */}
                       <div className="bg-volt/10 border border-volt-text/25 rounded-2xl p-5 relative group">
                          <h4 className="text-xs font-semibold text-volt-text uppercase mb-2 flex items-center">
                             <Zap className="w-3 h-3 mr-1" /> Recommended Pitch Angle
                          </h4>
                          <p className="text-neutral-300 text-sm leading-relaxed italic">
                             "{scanResult.angle}"
                          </p>
                          <button
                             onClick={() => navigator.clipboard.writeText(scanResult.angle)}
                             aria-label="Copy pitch angle"
                             className="absolute top-4 right-4 p-1.5 text-volt-text hover:text-white bg-white/[0.03] border border-white/10 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300"
                             title="Copy Angle"
                          >
                             <Copy className="w-3 h-3" />
                          </button>
                       </div>

                       <Button
                          onClick={handleSaveNotes}
                          loading={isSavingNote}
                          fullWidth
                          leftIcon={<Check className="w-4 h-4" />}
                       >
                          {isSavingNote ? 'Saving...' : 'Save Angle to Notes'}
                       </Button>

                       <div className="text-center">
                          <button
                             onClick={() => { setScanResult(null); setScanContext(''); }}
                             className="text-xs text-neutral-400 hover:text-neutral-200 underline transition-colors duration-300"
                          >
                             Scan Another
                          </button>
                       </div>
                    </motion.div>
                 )}
              </div>
           </motion.div>
        </div>
      )}
    </div>
  );
};
