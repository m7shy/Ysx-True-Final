import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Upload, Download, Search, Mail, Trash2, Loader2, X, Zap, Rocket, TrendingUp, Trophy, Radar, Check, Copy, AlertCircle, MessageSquare, Ghost } from 'lucide-react';
import { Lead, LeadStatus, OfferFitAnalysis } from '../types';
import { fetchLeads, addLead, updateLeadStatus, deleteLead, analyzeLead, updateLeadNotes, getLastEmailSnippet } from '../services/mockZoho';
import { analyzeOfferFit } from '../services/gemini';
import { useNotification } from '../context/NotificationContext';
import { ConfirmModal } from './ConfirmModal';

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
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  
  const [actionLoading, setActionLoading] = useState<string | null>(null); // ID of loading item (delete/status)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState(false);

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
      
      // Fetch snippets in background
      const newSnippets: Record<string, string> = {};
      await Promise.all(data.map(async (lead) => {
        try {
          const snippet = await getLastEmailSnippet(lead.email);
          if (snippet && isMounted.current) newSnippets[lead.id] = snippet;
        } catch (e) {
          // Silent fail for snippets
        }
      }));
      if (isMounted.current) setSnippets(newSnippets);
      
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
    
    try {
      const added = await addLead({
        name: newLead.name,
        email: newLead.email,
        company: newLead.company,
        source: newLead.source,
        status: 'NEW'
      });
      if (isMounted.current) {
        setLeads([added, ...leads]);
        setIsAddModalOpen(false);
        setNewLead({ name: '', email: '', company: '', source: 'Direct' });
        showToast('SUCCESS', "Lead added successfully.");
      }
    } catch (error) {
      console.error("Failed to add lead", error);
      showToast('ERROR', "Failed to add lead. Please try again.");
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

  const handleAnalyze = async (id: string) => {
    setAnalyzingIds(prev => new Set(prev).add(id));
    try {
      const updatedLead = await analyzeLead(id);
      if (isMounted.current) {
        setLeads(leads.map(l => l.id === id ? updatedLead : l));
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
      // Execute in parallel
      const promises = leadsToAnalyze.map(l => analyzeLead(l.id));
      const results = await Promise.all(promises);
      
      if (isMounted.current) {
        // Update local state
        setLeads(prevLeads => {
          const updatedMap = new Map(results.map(l => [l.id, l]));
          return prevLeads.map(l => updatedMap.get(l.id) || l);
        });
        showToast('SUCCESS', `Analyzed ${results.length} leads successfully.`);
      }
    } catch (error) {
      console.error("Bulk analysis failed", error);
      showToast('ERROR', "Bulk analysis partially failed. Check logs.");
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
        // Update local state
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

  const handleImport = () => {
    showToast('SUCCESS', 'Import Successful: 15 leads added (Simulated).');
  };

  const handleExport = () => {
    showToast('SUCCESS', 'Exporting leads to CSV...');
  };

  // Enhanced multi-term search
  const filteredLeads = leads.filter(l => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    // Split query into terms (e.g., "John Acme" -> ["john", "acme"])
    const terms = query.split(/\s+/);

    // Check if EVERY term matches at least one field
    return terms.every(term => 
      l.name.toLowerCase().includes(term) || 
      l.company.toLowerCase().includes(term) ||
      l.email.toLowerCase().includes(term) ||
      l.source.toLowerCase().includes(term)
    );
  });

  const scoredLeads = leads.filter(l => l.score !== undefined);
  const topLeads = [...scoredLeads].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  const hasScores = scoredLeads.length > 0;

  const StatusBadge = ({ status }: { status: LeadStatus }) => {
    const styles = {
        'NEW': 'bg-blue-500 text-blue-100',
        'CONTACTED': 'bg-amber-500 text-amber-100',
        'REPLIED': 'bg-indigo-500 text-indigo-100',
        'CALL_BOOKED': 'bg-purple-500 text-purple-100',
        'TRIAL': 'bg-cyan-500 text-cyan-100',
        'CLIENT_CLOSED': 'bg-emerald-500 text-emerald-100',
        'LOST': 'bg-slate-500 text-slate-100'
    };
    return (
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${styles[status] || 'bg-slate-500 text-slate-100'}`}>
            {status.replace('_', ' ')}
        </span>
    );
  };

  return (
    <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col overflow-y-auto custom-scrollbar">
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
           <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 text-white shadow-lg border border-slate-700 relative overflow-hidden animate-in fade-in slide-in-from-top-4">
             <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full translate-x-1/3 -translate-y-1/3 blur-3xl" />
             
             <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center">
                   <Trophy className="w-6 h-6 text-yellow-400 mr-3" />
                   <div>
                     <h3 className="text-lg font-bold">Today's Big 10</h3>
                     <p className="text-slate-400 text-sm">Highest scoring prospects based on engagement & fit.</p>
                   </div>
                </div>
                <div className="text-right hidden md:block">
                   <div className="text-2xl font-bold text-brand-400">{Math.round(scoredLeads.reduce((acc, l) => acc + (l.score || 0), 0) / scoredLeads.length)}</div>
                   <div className="text-xs text-slate-400 uppercase tracking-wider">Avg Score</div>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 relative z-10">
                {topLeads.slice(0, 3).map((lead, i) => (
                  <div key={lead.id} className="bg-white/5 hover:bg-white/10 transition-colors p-3 rounded-lg border border-white/10 flex items-center justify-between group cursor-pointer" onClick={() => onCompose(lead)}>
                     <div className="flex items-center min-w-0">
                        <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mr-3 ${i === 0 ? 'bg-yellow-500 text-yellow-900' : i === 1 ? 'bg-slate-300 text-slate-900' : 'bg-amber-700 text-amber-100'}`}>
                           {i + 1}
                        </div>
                        <div className="min-w-0">
                           <div className="text-sm font-medium group-hover:text-brand-300 transition-colors truncate">{lead.name}</div>
                           <div className="text-xs text-slate-400 truncate">{lead.company}</div>
                        </div>
                     </div>
                     <div className="text-lg font-bold text-emerald-400 ml-2">{lead.score}</div>
                  </div>
                ))}
             </div>
           </div>
         ) : (
            <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 animate-in zoom-in-95">
               <div className="flex items-center text-center md:text-left flex-col md:flex-row">
                  <div className="w-12 h-12 bg-brand-100 dark:bg-brand-800 rounded-full flex items-center justify-center md:mr-4 mb-2 md:mb-0">
                     <Rocket className="w-6 h-6 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                     <h3 className="text-lg font-bold text-brand-900 dark:text-brand-200">Unlock Lead Intelligence</h3>
                     <p className="text-brand-700 dark:text-brand-400 text-sm">Run intelligence to identify top prospects and score leads automatically.</p>
                  </div>
               </div>
               <button 
                  onClick={handleBulkAnalyze}
                  disabled={isBulkAnalyzing}
                  className="w-full md:w-auto px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-lg shadow-brand-500/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap flex items-center justify-center"
               >
                  {isBulkAnalyzing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2 fill-white" />}
                  {isBulkAnalyzing ? 'Analyzing...' : 'Run Intelligence on All Leads'}
               </button>
            </div>
         )}
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
            <Users className="w-6 h-6 mr-2 text-brand-500" />
            Lead Management
          </h2>
        </div>
        
        <div className="flex flex-wrap gap-2 md:gap-3">
          {hasScores && leads.some(l => l.score === undefined) && (
             <button 
               onClick={handleBulkAnalyze}
               disabled={isBulkAnalyzing}
               className="flex items-center px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
             >
                {isBulkAnalyzing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                <span className="hidden sm:inline">Run Remaining</span>
             </button>
          )}
          <button onClick={handleImport} className="flex items-center px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
             <Upload className="w-4 h-4 mr-2" /> <span className="hidden sm:inline">Import</span>
          </button>
          <button onClick={handleExport} className="flex items-center px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
             <Download className="w-4 h-4 mr-2" /> <span className="hidden sm:inline">Export</span>
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-lg shadow-brand-500/20 active:scale-95 text-sm font-bold flex-1 md:flex-none justify-center"
          >
            <Plus className="w-4 h-4 mr-2" /> Add Lead
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 relative max-w-md">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-slate-400" />
        </div>
        <input
          type="text"
          placeholder="Search (e.g. 'John Acme')..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="block w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 sm:text-sm transition-shadow shadow-sm"
        />
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {loading ? (
           <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p>Loading leads...</p>
           </div>
        ) : filteredLeads.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
             <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                <Ghost className="w-8 h-8 text-slate-400" />
             </div>
             <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">No Leads Found</h3>
             <p className="text-slate-500 dark:text-slate-400 text-sm">
                Try adjusting your search or add a new lead to get started.
             </p>
           </div>
        ) : (
          filteredLeads.map(lead => (
            <div key={lead.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
               <div className="flex justify-between items-start mb-3">
                  <div>
                     <h3 className="font-bold text-slate-900 dark:text-white">{lead.name}</h3>
                     <div className="text-xs text-slate-500 dark:text-slate-400">{lead.company}</div>
                  </div>
                  <StatusBadge status={lead.status} />
               </div>
               
               <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                     <p className="text-[10px] uppercase text-slate-400 font-bold mb-1">Score</p>
                     {lead.score !== undefined ? (
                        <div className="flex items-center">
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${
                               lead.score >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                               lead.score >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                               'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                               {lead.score}
                            </span>
                        </div>
                      ) : (
                         <button 
                           onClick={() => handleAnalyze(lead.id)}
                           disabled={analyzingIds.has(lead.id)}
                           className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center disabled:opacity-50"
                         >
                            {analyzingIds.has(lead.id) ? 'Analyzing...' : 'Run AI Scan'}
                         </button>
                      )}
                  </div>
                  <div>
                     <p className="text-[10px] uppercase text-slate-400 font-bold mb-1">Last Contact</p>
                     <p className="text-sm text-slate-700 dark:text-slate-300">{lead.lastContacted ? new Date(lead.lastContacted).toLocaleDateString() : '-'}</p>
                  </div>
               </div>

               <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex space-x-1">
                     <button onClick={() => handleOpenScan(lead)} className="p-2 text-slate-400 hover:text-brand-600 bg-slate-50 dark:bg-slate-800 rounded-lg" title="Scan Fit">
                        <Radar className="w-4 h-4" />
                     </button>
                     <button onClick={() => onCompose(lead)} className="p-2 text-slate-400 hover:text-brand-600 bg-slate-50 dark:bg-slate-800 rounded-lg" title="Email">
                        <Mail className="w-4 h-4" />
                     </button>
                     <button onClick={() => setDeleteId(lead.id)} disabled={actionLoading === lead.id} className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        {actionLoading === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                     </button>
                  </div>
                  
                  <select 
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                    className="text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-lg py-1.5 pl-2 pr-6 focus:ring-0 font-medium text-slate-700 dark:text-slate-300"
                  >
                     <option value="NEW">New</option>
                     <option value="CONTACTED">Contacted</option>
                     <option value="REPLIED">Replied</option>
                     <option value="CALL_BOOKED">Call Booked</option>
                     <option value="TRIAL">Trial</option>
                     <option value="CLIENT_CLOSED">Client Closed</option>
                     <option value="LOST">Lost</option>
                  </select>
               </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:flex bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex-1 flex-col min-h-[400px]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 uppercase text-xs font-bold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Score</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Contact</th>
                <th className="px-6 py-4">Source</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex justify-center items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" /> Loading leads...
                    </div>
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-24 text-center">
                     <div className="flex flex-col items-center justify-center">
                        <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-100 dark:border-slate-700">
                           <Search className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">No Leads Found</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-xs leading-relaxed">
                           We couldn't find any leads matching your criteria. Try a different search term or import new data.
                        </p>
                     </div>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-white">{lead.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{lead.email}</div>
                      {lead.company && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{lead.company}</div>}
                      
                      {snippets[lead.id] && (
                         <div className="mt-2 text-[10px] text-slate-400 italic flex items-start max-w-[200px] opacity-70 group-hover:opacity-100 transition-opacity">
                            <MessageSquare className="w-3 h-3 mr-1 shrink-0 mt-0.5" />
                            <span className="truncate">"{snippets[lead.id]}"</span>
                         </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {lead.score !== undefined ? (
                         <div className="flex items-center">
                            <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                               lead.score >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                               lead.score >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                               'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                               {lead.score}
                            </span>
                         </div>
                      ) : (
                         <button 
                           onClick={() => handleAnalyze(lead.id)}
                           disabled={analyzingIds.has(lead.id)}
                           className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 px-2 py-1 rounded transition-colors flex items-center disabled:opacity-50"
                         >
                            {analyzingIds.has(lead.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
                            Analyze
                         </button>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <select 
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                        disabled={actionLoading === lead.id}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border-none outline-none cursor-pointer transition-colors bg-opacity-20 hover:bg-opacity-30 ${
                          lead.status === 'NEW' ? 'bg-blue-500 text-blue-700 dark:text-blue-300' :
                          lead.status === 'CONTACTED' ? 'bg-amber-500 text-amber-700 dark:text-amber-300' :
                          lead.status === 'REPLIED' ? 'bg-indigo-500 text-indigo-700 dark:text-indigo-300' :
                          lead.status === 'CALL_BOOKED' ? 'bg-purple-500 text-purple-700 dark:text-purple-300' :
                          lead.status === 'TRIAL' ? 'bg-cyan-500 text-cyan-700 dark:text-cyan-300' :
                          lead.status === 'CLIENT_CLOSED' ? 'bg-emerald-500 text-emerald-700 dark:text-emerald-300' :
                          'bg-slate-500 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <option value="NEW">New</option>
                        <option value="CONTACTED">Contacted</option>
                        <option value="REPLIED">Replied</option>
                        <option value="CALL_BOOKED">Call Booked</option>
                        <option value="TRIAL">Trial</option>
                        <option value="CLIENT_CLOSED">Client Closed</option>
                        <option value="LOST">Lost</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400 tabular-nums">
                      {lead.lastContacted ? new Date(lead.lastContacted).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                      {lead.source}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button 
                           onClick={() => handleOpenScan(lead)}
                           className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded transition-colors"
                           title="Scan Fit"
                        >
                           <Radar className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => onCompose(lead)}
                          className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded transition-colors"
                          title="Email Lead"
                        >
                          <Mail className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteId(lead.id)}
                          disabled={actionLoading === lead.id}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Delete Lead"
                        >
                          {actionLoading === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Lead Modal & Scanner Modal remain unchanged, just using same pattern */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
               <h3 className="font-bold text-lg text-slate-900 dark:text-white">Add New Lead</h3>
               <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X className="w-5 h-5" />
               </button>
            </div>
            <form onSubmit={handleAddLead} className="p-6 space-y-4">
               <div>
                 <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Full Name</label>
                 <input 
                    type="text" 
                    required
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500"
                    value={newLead.name}
                    onChange={e => setNewLead({...newLead, name: e.target.value})}
                 />
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Email Address</label>
                 <input 
                    type="email" 
                    required
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500"
                    value={newLead.email}
                    onChange={e => setNewLead({...newLead, email: e.target.value})}
                 />
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Company</label>
                 <input 
                    type="text" 
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500"
                    value={newLead.company}
                    onChange={e => setNewLead({...newLead, company: e.target.value})}
                 />
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Source</label>
                 <select 
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500"
                    value={newLead.source}
                    onChange={e => setNewLead({...newLead, source: e.target.value})}
                 >
                   <option>Direct</option>
                   <option>LinkedIn</option>
                   <option>Website</option>
                   <option>Referral</option>
                   <option>Event</option>
                 </select>
               </div>
               <button type="submit" className="w-full py-2.5 bg-brand-600 text-white rounded-lg font-bold hover:bg-brand-700 transition-colors mt-2">
                  Add Lead
               </button>
            </form>
          </div>
        </div>
      )}

      {/* Offer Fit Scanner Modal */}
      {isScanModalOpen && selectedLeadForScan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
           <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                 <div className="flex items-center">
                    <Radar className="w-5 h-5 text-brand-500 mr-2" />
                    <div>
                       <h3 className="font-bold text-lg text-slate-900 dark:text-white">Scan Lead Fit</h3>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Analyzing for: <span className="font-medium">{selectedLeadForScan.name}</span></p>
                    </div>
                 </div>
                 <button onClick={() => setIsScanModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <X className="w-5 h-5" />
                 </button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                 {!scanResult ? (
                    <div className="space-y-4 h-full flex flex-col">
                       <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300 mb-2 flex items-start">
                          <AlertCircle className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                          <p>Paste their Twitter/LinkedIn bio, About page text, or recent content below. Gemini will analyze if they're a good fit for high-ticket video editing.</p>
                       </div>
                       <div className="flex-1">
                          <textarea 
                             value={scanContext}
                             onChange={(e) => setScanContext(e.target.value)}
                             placeholder="Paste Profile URL, Bio, or About Page text here..."
                             className="w-full h-48 p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-brand-500 outline-none resize-none"
                          />
                       </div>
                       <button 
                          onClick={handleRunScan}
                          disabled={isScanning || !scanContext.trim()}
                          className="w-full py-3 bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                       >
                          {isScanning ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Rocket className="w-5 h-5 mr-2" />}
                          {isScanning ? 'Analyzing Fit...' : 'Run Analysis'}
                       </button>
                    </div>
                 ) : (
                    <div className="space-y-6 animate-in slide-in-from-bottom-4">
                       {/* Result Header */}
                       <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div className="text-center">
                             <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fit Score</div>
                             <div className={`text-4xl font-black ${
                                scanResult.score >= 80 ? 'text-green-500' : 
                                scanResult.score >= 50 ? 'text-amber-500' : 'text-red-500'
                             }`}>
                                {scanResult.score}
                             </div>
                          </div>
                          <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />
                          <div className="text-center">
                             <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Maturity</div>
                             <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                scanResult.maturity === 'Pro' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 
                                scanResult.maturity === 'Mid' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 
                                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                             }`}>
                                {scanResult.maturity}
                             </span>
                          </div>
                          <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />
                          <div className="text-center">
                             <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Offer</div>
                             <div className="text-sm font-semibold text-slate-900 dark:text-white max-w-[100px] truncate" title={scanResult.product}>
                                {scanResult.product}
                             </div>
                          </div>
                       </div>

                       {/* Pitch Angle */}
                       <div className="bg-brand-50 dark:bg-brand-900/10 border border-brand-100 dark:border-brand-900/30 rounded-xl p-5 relative group">
                          <h4 className="text-xs font-bold text-brand-600 dark:text-brand-400 uppercase mb-2 flex items-center">
                             <Zap className="w-3 h-3 mr-1" /> Recommended Pitch Angle
                          </h4>
                          <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed italic">
                             "{scanResult.angle}"
                          </p>
                          <button 
                             onClick={() => navigator.clipboard.writeText(scanResult.angle)}
                             className="absolute top-4 right-4 p-1.5 text-brand-400 hover:text-brand-600 bg-white dark:bg-slate-800 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                             title="Copy Angle"
                          >
                             <Copy className="w-3 h-3" />
                          </button>
                       </div>

                       <button 
                          onClick={handleSaveNotes}
                          disabled={isSavingNote}
                          className="w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold shadow-md hover:shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center disabled:opacity-70"
                       >
                          {isSavingNote ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                          {isSavingNote ? 'Saving...' : 'Save Angle to Notes'}
                       </button>
                       
                       <div className="text-center">
                          <button 
                             onClick={() => { setScanResult(null); setScanContext(''); }}
                             className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline"
                          >
                             Scan Another
                          </button>
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};