
import React, { useState, useEffect } from 'react';
import { Email, FollowUpTone, GeneratedDraft, EmailAnalysisResult, EmailStatus } from '../types';
import { generateFollowUpDraft, analyzeSpamLikelihood } from '../services/gemini';
import { fetchSentEmails } from '../services/mockZoho';
import { Wand2, Send, RefreshCw, Edit3, Copy, Calendar, Check, X, Clock, AlertTriangle, History, Quote, ShieldCheck, Loader2, BarChart2, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

interface ComposeFollowUpProps {
  email: Email;
  onClose: () => void;
  onComplete: (date?: string, content?: string) => void; // If date is present, it's scheduled
  signature?: string;
  defaultTone?: FollowUpTone;
}

export const ComposeFollowUp: React.FC<ComposeFollowUpProps> = ({ email, onClose, onComplete, signature, defaultTone }) => {
  const { settings } = useSettings();
  const [tone, setTone] = useState<FollowUpTone>(defaultTone || FollowUpTone.PROFESSIONAL);
  const [additionalContext, setAdditionalContext] = useState('');
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Scheduling state
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [sendDelay, setSendDelay] = useState<number>(3);

  // Confirmation state
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, type: 'SEND' | 'SCHEDULE' | null}>({ isOpen: false, type: null });

  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<EmailAnalysisResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    tone: true,
    triggers: true,
    suggestions: true
  });

  // UI state
  const [subjectCopied, setSubjectCopied] = useState(false);

  // Preset options for scheduling
  const schedulePresets = [
    { label: 'Tomorrow', days: 1 },
    { label: '+3 Days', days: 3 },
    { label: '+1 Week', days: 7 },
    { label: '+1 Month', days: 30 }
  ];

  // Helper to get date string YYYY-MM-DD based on local time
  const getFutureDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Reset state when email changes
  useEffect(() => {
    setDraft(null);
    setAdditionalContext('');
    setTone(defaultTone || FollowUpTone.PROFESSIONAL);
    setIsScheduling(false);
    setConfirmDialog({ isOpen: false, type: null });
    setShowAnalysis(false);
    setAnalysisResult(null);
    // Default schedule to 3 days from now
    setSendDelay(3);
    setScheduledDate(getFutureDate(3));
  }, [email.id, defaultTone]);

  // Real-time spam checking with debounce
  useEffect(() => {
    if (!draft) return;

    const timer = setTimeout(async () => {
      // Check for sufficient content before analyzing
      if ((draft.body && draft.body.length > 10) || (draft.subject && draft.subject.length > 3)) {
        try {
          const result = await analyzeSpamLikelihood(draft.subject, draft.body);
          setAnalysisResult(result);
        } catch (error) {
          console.error("Auto-analysis failed", error);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [draft?.subject, draft?.body]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Fetch past emails for style mimicry
      let examples: string[] = [];
      try {
        const pastEmails = await fetchSentEmails();
        examples = pastEmails
          .filter(e => e.status === EmailStatus.SENT || e.status === EmailStatus.REPLIED)
          .slice(0, 3)
          .map(e => e.body);
      } catch (fetchErr) {
        console.warn("Could not fetch past emails for style mimicry:", fetchErr);
      }

      const generated = await generateFollowUpDraft(email, tone, additionalContext, examples, signature);
      setDraft(generated);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDraft(prev => prev ? { ...prev, subject: value } : null);
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(prev => prev ? { ...prev, body: value } : null);
  };

  const handleCopySubject = () => {
    if (draft?.subject) {
      navigator.clipboard.writeText(draft.subject);
      setSubjectCopied(true);
      setTimeout(() => setSubjectCopied(false), 2000);
    }
  };

  const initiateSend = () => {
    setConfirmDialog({ isOpen: true, type: 'SEND' });
  };

  const initiateSchedule = () => {
    if (!scheduledDate) return;
    setConfirmDialog({ isOpen: true, type: 'SCHEDULE' });
  };

  const handleConfirmAction = () => {
    const type = confirmDialog.type;
    setConfirmDialog({ isOpen: false, type: null });
    setIsProcessing(true);

    if (type === 'SEND') {
      // Simulate network request
      setTimeout(() => {
        setIsProcessing(false);
        onComplete(undefined, draft?.body); // No date means sent immediately, pass content
      }, 1500);
    } else if (type === 'SCHEDULE') {
      setTimeout(() => {
        setIsProcessing(false);
        // Append time to avoid timezone issues
        const isoDateTime = `${scheduledDate}T09:00:00`;
        onComplete(isoDateTime, draft?.body); // Date present means scheduled, pass content
      }, 1000);
    }
  };

  const handleDelayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const days = parseInt(e.target.value) || 0;
    setSendDelay(days);
    setScheduledDate(getFutureDate(days));
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setScheduledDate(newDate);
    
    // Calculate days difference
    if (newDate) {
      const start = new Date();
      start.setHours(0,0,0,0);
      const parts = newDate.split('-');
      // Create date using local components to avoid UTC shifts
      const end = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      setSendDelay(diffDays > 0 ? diffDays : 0);
    }
  };

  const applyPreset = (days: number) => {
    setSendDelay(days);
    setScheduledDate(getFutureDate(days));
  };

  const toggleSection = (section: 'tone' | 'triggers' | 'suggestions') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleAnalyzeSpam = async () => {
    if (!draft?.subject && !draft?.body) return;
    setIsAnalyzing(true);
    setShowAnalysis(true);
    try {
      const result = await analyzeSpamLikelihood(draft.subject, draft.body);
      setAnalysisResult(result);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalysisToggle = () => {
    if (analysisResult) {
      setShowAnalysis(!showAnalysis);
    } else {
      handleAnalyzeSpam();
    }
  };

  return (
    <div className="h-full w-full max-w-2xl ml-auto bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-500 flex flex-col relative overflow-hidden">
      
      {/* Confirmation Dialog Overlay */}
      {confirmDialog.isOpen && (
        <div className="absolute inset-0 z-50 bg-slate-900/30 dark:bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 max-w-sm w-full transform scale-100 animate-in zoom-in-95 duration-300 slide-in-from-bottom-4">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 rounded-full mb-4 mx-auto animate-bounce">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white text-center mb-2">
              {confirmDialog.type === 'SEND' ? 'Send Follow-Up?' : 'Schedule Follow-Up?'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6">
              {confirmDialog.type === 'SEND' 
                ? "This email will be sent immediately to the recipient. Are you sure?" 
                : `This email will be automatically sent on ${new Date(scheduledDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} if no reply is received.`}
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setConfirmDialog({ isOpen: false, type: null })}
                className="flex-1 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors active:scale-95 duration-150"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmAction}
                className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition-all shadow-sm active:scale-95 duration-150 ${confirmDialog.type === 'SEND' ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/25' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/25'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Panel (Overlay) */}
      {showAnalysis && (
        <div className="absolute inset-y-0 right-0 w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-40 overflow-y-auto animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 sticky top-0">
            <h3 className="font-bold text-slate-800 dark:text-white flex items-center">
              <ShieldCheck className="w-4 h-4 mr-2 text-brand-500" />
              Deliverability Audit
            </h3>
            <button onClick={() => setShowAnalysis(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          {isAnalyzing ? (
            <div className="p-8 flex flex-col items-center text-center space-y-4">
              <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
              <p className="text-sm text-slate-500">Analyzing headers, keywords, and tone...</p>
            </div>
          ) : analysisResult ? (
            <div className="p-4 space-y-6">
              {/* Score Card */}
              <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Safety Score</p>
                <div className={`text-4xl font-bold mb-1 ${
                  analysisResult.score > 80 ? 'text-green-500' : 
                  analysisResult.score > 50 ? 'text-amber-500' : 'text-red-500'
                }`}>
                  {analysisResult.score}/100
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  analysisResult.spamLikelihood === 'LOW' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                  analysisResult.spamLikelihood === 'MEDIUM' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {analysisResult.spamLikelihood} Risk
                </span>
              </div>

              {/* Tone */}
              <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                <button 
                  onClick={() => toggleSection('tone')}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                   <div className="flex items-center">
                      <BarChart2 className="w-3 h-3 mr-1" /> Tone Analysis
                   </div>
                   {expandedSections.tone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                
                {expandedSections.tone && (
                  <p className="text-sm text-slate-700 dark:text-slate-300 italic border-l-2 border-brand-500 pl-3 animate-in slide-in-from-top-1 fade-in duration-200">
                      "{analysisResult.toneAudit}"
                  </p>
                )}
              </div>

              {/* Trigger Words */}
              {analysisResult.triggerWords.length > 0 && (
                <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                  <button 
                    onClick={() => toggleSection('triggers')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    <div className="flex items-center">
                       <AlertTriangle className="w-3 h-3 mr-1" /> Trigger Words ({analysisResult.triggerWords.length})
                    </div>
                    {expandedSections.triggers ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  
                  {expandedSections.triggers && (
                      <div className="flex flex-wrap gap-1.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        {analysisResult.triggerWords.map((word, i) => (
                          <span key={i} className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-md border border-red-100 dark:border-red-800/50">
                            {word}
                          </span>
                        ))}
                      </div>
                  )}
                </div>
              )}

              {/* Suggestions */}
              {analysisResult.suggestions.length > 0 && (
                <div className="pt-2">
                  <button 
                    onClick={() => toggleSection('suggestions')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-3 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                     <div className="flex items-center">
                        <Lightbulb className="w-3 h-3 mr-1 text-brand-500" /> Smart Improvements
                     </div>
                     {expandedSections.suggestions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  
                  {expandedSections.suggestions && (
                      <ul className="space-y-2.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        {analysisResult.suggestions.map((suggestion, i) => (
                          <li key={i} className="flex items-start group">
                            <div className="mt-0.5 mr-2.5 flex-shrink-0 w-5 h-5 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center border border-amber-100 dark:border-amber-900/30">
                              <Lightbulb className="w-3 h-3 text-amber-500" />
                            </div>
                            <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="animate-in fade-in slide-in-from-left-2 duration-500">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Compose Follow-Up</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Drafting for <span className="font-medium text-slate-700 dark:text-slate-300">{email.recipientName}</span></p>
        </div>
        <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-transform hover:rotate-90 p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* SECTION: CONTEXT & HISTORY */}
        <div className="space-y-4">
          
          {/* Follow-up History Block */}
          {email.followupHistory && email.followupHistory.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in slide-in-from-top-2">
              <div className="px-4 py-2 bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center">
                 <History className="w-4 h-4 text-brand-500 mr-2" />
                 <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Conversation History</h4>
              </div>
              <div className="p-4 space-y-4">
                  {email.followupHistory.map((item, idx) => (
                    <div key={idx} className="relative pl-5 group">
                       {/* Timeline Line */}
                       {idx !== (email.followupHistory!.length - 1) && (
                          <div className="absolute left-[5px] top-2.5 bottom-[-20px] w-px bg-slate-300 dark:bg-slate-700" />
                       )}
                       
                       <div className={`absolute -left-[1px] top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${item.status === 'SENT' ? 'bg-emerald-500' : 'bg-purple-500'} shadow-sm`} />
                       
                       <div className="flex justify-between items-start mb-1">
                          <span className={`text-xs font-semibold ${item.status === 'SENT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-purple-600 dark:text-purple-400'}`}>
                            {item.status === 'SENT' ? 'Follow-up Sent' : 'Scheduled'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-700">
                            {new Date(item.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                          </span>
                       </div>
                       <p className="text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-2 rounded border border-slate-100 dark:border-slate-700/50 italic">
                         "{item.content.length > 120 ? item.content.substring(0, 120) + '...' : item.content}"
                       </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Original Context Block */}
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
             <div className="px-4 py-2 bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between group cursor-default">
                <div className="flex items-center">
                  <Quote className="w-4 h-4 text-slate-400 mr-2" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Original Email</h4>
                </div>
                <span className="text-[10px] text-slate-400">{new Date(email.sentDate).toLocaleDateString()}</span>
             </div>
             <div className="p-4">
                <p className="text-slate-800 dark:text-slate-200 font-semibold text-sm mb-2">{email.subject}</p>
                <div className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed bg-white dark:bg-slate-800 p-3 rounded border border-slate-100 dark:border-slate-700/50 max-h-32 overflow-y-auto custom-scrollbar">
                   {email.body}
                </div>
             </div>
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        {/* SECTION: DRAFTING WORKSPACE */}
        <div className="space-y-6">
          <div className="flex items-center space-x-2">
            <Wand2 className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Draft Response</h3>
          </div>

          {/* Controls - Always visible to allow regeneration */}
          <div className="space-y-4 bg-white dark:bg-slate-900">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Select Tone</label>
                <div className="flex flex-wrap gap-2">
                  {Object.values(FollowUpTone).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`px-4 py-2 text-sm rounded-lg border transition-all active:scale-95 ${
                        tone === t 
                          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-500 text-brand-700 dark:text-brand-300 font-medium shadow-sm ring-1 ring-brand-500' 
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Specific Instructions (Optional)</label>
                <textarea
                  className="w-full p-3 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none h-24 transition-shadow bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400"
                  placeholder="e.g., Mention the discount expires on Friday, keep it under 50 words..."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex-1 flex items-center justify-center space-x-2 py-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg shadow-lg shadow-brand-500/30 transition-all disabled:opacity-70 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {isGenerating ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Wand2 className="w-5 h-5 animate-pulse" />
                  )}
                  <span className="font-semibold">{isGenerating ? 'Drafting with Gemini...' : 'Generate Follow-up Draft'}</span>
                </button>

                {draft && (
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="flex items-center justify-center px-5 py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm hover:shadow active:scale-95"
                      title="Regenerate with same settings"
                    >
                       <RefreshCw className={`w-5 h-5 ${isGenerating ? 'animate-spin' : ''}`} />
                       <span className="ml-2 font-medium">Regenerate</span>
                    </button>
                )}
              </div>
          </div>

          {/* Generated Draft Editor */}
          {draft && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-4 bg-white dark:bg-slate-900 rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center">
                    <Edit3 className="w-4 h-4 mr-2 text-brand-500" />
                    Editor
                  </h3>
                  <div className="flex items-center space-x-3">
                     {/* Added Warning */}
                     {analysisResult && analysisResult.score < 70 && (
                        <span className="hidden sm:flex text-xs font-medium text-amber-600 dark:text-amber-400 items-center animate-pulse mr-2">
                          <AlertTriangle className="w-3 h-3 mr-1" /> High Risk
                        </span>
                     )}
                     <button
                        type="button"
                        onClick={handleAnalysisToggle}
                        disabled={isAnalyzing}
                        className={`text-xs flex items-center transition-colors ${
                            analysisResult 
                            ? 'text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 font-medium' 
                            : 'text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-50'
                        }`}
                      >
                         {isAnalyzing ? (
                             <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                         ) : (
                             <ShieldCheck className={`w-3 h-3 mr-1 ${analysisResult ? 'text-brand-500' : ''}`} />
                         )}
                         {isAnalyzing ? 'Checking...' : analysisResult ? 'View Analysis' : 'Check Spam Score'}
                      </button>
                      <div className="h-3 w-px bg-slate-300 dark:bg-slate-700" />
                      <button 
                        onClick={handleGenerate}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 flex items-center hover:underline decoration-brand-200"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                      </button>
                  </div>
              </div>

              <div className="space-y-4 group">
                <div className="space-y-1 mb-2">
                   <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Subject</label>
                       <button 
                          onClick={handleCopySubject}
                          className={`text-xs flex items-center gap-1 transition-colors ${subjectCopied ? 'text-green-500' : 'text-slate-400 hover:text-brand-600'}`}
                        >
                          {subjectCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {subjectCopied ? 'Copied' : 'Copy'}
                        </button>
                   </div>
                   <div className="relative group">
                      <input 
                        value={draft.subject}
                        onChange={handleSubjectChange}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white text-sm font-medium focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all shadow-sm group-hover:border-slate-300 dark:group-hover:border-slate-600"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                         <Edit3 className="w-3 h-3 text-slate-400" />
                      </div>
                   </div>
                </div>
                
                <div className="relative">
                  <textarea
                    value={draft.body}
                    onChange={handleBodyChange}
                    className="w-full h-64 text-slate-700 dark:text-slate-300 leading-relaxed outline-none resize-none bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-transparent focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {draft && (
          <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col space-y-3 animate-in slide-in-from-bottom-full duration-500 delay-100 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.2)]">
            {/* Scheduling UI */}
            {isScheduling && (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 p-4 rounded-lg animate-in slide-in-from-bottom-2 mb-2 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> Auto-Schedule Follow-Up
                  </span>
                  <button
                    onClick={() => setIsScheduling(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {settings.useRealApi && (
                  <div className="flex items-center text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded border border-amber-200 dark:border-amber-800 mb-3">
                    <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
                    <span>Scheduling is not supported in Client-Side mode (requires backend).</span>
                  </div>
                )}

                {/* Quick Presets */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {schedulePresets.map((preset) => {
                    const targetDate = getFutureDate(preset.days);
                    const isActive = scheduledDate === targetDate;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => applyPreset(preset.days)}
                        disabled={settings.useRealApi}
                        className={`px-2 py-1.5 text-xs border rounded transition-all font-medium active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isActive
                            ? 'bg-purple-600 border-purple-600 text-white shadow-md scale-105'
                            : 'bg-white dark:bg-slate-800 border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:border-purple-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center space-x-3">
                  {/* Send Delay Input */}
                  <div className="w-24 relative">
                    <label className="absolute -top-1.5 left-2 bg-white dark:bg-slate-800 px-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-none">
                      Delay (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={sendDelay}
                      onChange={handleDelayChange}
                      disabled={settings.useRealApi}
                      className="w-full p-2 text-sm border border-purple-200 dark:border-purple-700 rounded text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-purple-500 outline-none shadow-sm transition-shadow disabled:opacity-50"
                    />
                  </div>

                  <div className="flex-1">
                    <input
                      type="date"
                      min={new Date().toISOString().split('T')[0]}
                      value={scheduledDate}
                      onChange={handleDateChange}
                      disabled={settings.useRealApi}
                      className="w-full p-2 text-sm border border-purple-200 dark:border-purple-700 rounded text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-purple-500 outline-none shadow-sm transition-shadow disabled:opacity-50"
                    />
                  </div>

                  <button
                    onClick={initiateSchedule}
                    disabled={isProcessing || !scheduledDate || settings.useRealApi}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700 transition-all flex items-center disabled:opacity-50 whitespace-nowrap shadow-md hover:shadow-lg active:scale-95 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-1" />
                    )}
                    Confirm Schedule
                  </button>
                </div>

                <p className="text-xs text-purple-700/80 dark:text-purple-300/80 mt-3 font-medium animate-in fade-in">
                  {scheduledDate ? (
                    <>
                      Follow-up set for{' '}
                      <span className="font-bold underline decoration-purple-300 dark:decoration-purple-600">
                        {new Date(scheduledDate).toLocaleDateString(undefined, {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </span>
                      . It will send automatically if no reply is received.
                    </>
                  ) : (
                    'Select a date to enable auto-follow up.'
                  )}
                </p>
              </div>
            )}

            {/* Action row */}
            <div className="flex justify-between items-center">
              <button
                onClick={() => setDraft(null)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white text-sm font-medium transition-colors hover:underline"
              >
                Cancel
              </button>

              <div className="flex space-x-3">
                <button
                  className="flex items-center px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95"
                  onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All
                </button>

                {!isScheduling && (
                  <button
                    onClick={() => setIsScheduling(true)}
                    className="flex items-center px-4 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:border-purple-300 rounded-lg text-sm font-medium transition-all active:scale-95 hover:shadow-sm"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Schedule
                  </button>
                )}

                {!isScheduling && (
                  <button
                    onClick={initiateSend}
                    disabled={isProcessing}
                    className="flex items-center px-6 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium transition-all disabled:opacity-70 active:scale-95 hover:scale-105"
                  >
                    {isProcessing ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {isProcessing ? 'Sending...' : 'Send Now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
