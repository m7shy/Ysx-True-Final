
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
    <div className="h-full w-full max-w-2xl ml-auto bg-noir border-l border-white/10 animate-in slide-in-from-right duration-500 flex flex-col relative overflow-hidden">

      {/* Confirmation Dialog Overlay */}
      {confirmDialog.isOpen && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white/[0.03] rounded-2xl border border-white/10 p-6 max-w-sm w-full transform scale-100 animate-in zoom-in-95 duration-300 slide-in-from-bottom-4">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-500/15 text-amber-400 rounded-full mb-4 mx-auto animate-bounce">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white text-center mb-2">
              {confirmDialog.type === 'SEND' ? 'Send Follow-Up?' : 'Schedule Follow-Up?'}
            </h3>
            <p className="text-sm text-neutral-400 text-center mb-6">
              {confirmDialog.type === 'SEND'
                ? "This email will be sent immediately to the recipient. Are you sure?"
                : `This email will be automatically sent on ${new Date(scheduledDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} if no reply is received.`}
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setConfirmDialog({ isOpen: false, type: null })}
                className="flex-1 px-4 py-2 bg-white/[0.03] border border-white/10 text-white rounded-full font-medium hover:bg-white/[0.06] hover:border-white/16 transition-colors active:scale-95 duration-150"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`flex-1 px-4 py-2 rounded-full text-white font-medium transition-all active:scale-95 duration-150 ${confirmDialog.type === 'SEND' ? 'bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)]' : 'bg-purple-600 hover:bg-purple-500'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Panel (Overlay) */}
      {showAnalysis && (
        <div className="absolute inset-y-0 right-0 w-80 bg-noir border-l border-white/10 z-40 overflow-y-auto animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02] sticky top-0">
            <h3 className="font-semibold text-white flex items-center">
              <ShieldCheck className="w-4 h-4 mr-2 text-volt-text" />
              Deliverability Audit
            </h3>
            <button onClick={() => setShowAnalysis(false)} aria-label="Close analysis panel" className="text-neutral-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {isAnalyzing ? (
            <div className="p-8 flex flex-col items-center text-center space-y-4">
              <Loader2 className="w-8 h-8 text-volt-text animate-spin" />
              <p className="text-sm text-neutral-400">Analyzing headers, keywords, and tone...</p>
            </div>
          ) : analysisResult ? (
            <div className="p-4 space-y-6">
              {/* Score Card */}
              <div className="text-center p-4 bg-white/[0.02] rounded-2xl border border-white/10">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">Safety Score</p>
                <div className={`text-4xl font-semibold mb-1 ${
                  analysisResult.score > 80 ? 'text-green-400' :
                  analysisResult.score > 50 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {analysisResult.score}/100
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${
                  analysisResult.spamLikelihood === 'LOW' ? 'bg-green-500/15 text-green-400 border-green-500/25' :
                  analysisResult.spamLikelihood === 'MEDIUM' ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' :
                  'bg-red-500/15 text-red-400 border-red-500/25'
                }`}>
                  {analysisResult.spamLikelihood} Risk
                </span>
              </div>

              {/* Tone */}
              <div className="border-b border-white/10 pb-4">
                <button
                  onClick={() => toggleSection('tone')}
                  className="w-full flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase mb-2 hover:text-neutral-300 transition-colors"
                >
                   <div className="flex items-center">
                      <BarChart2 className="w-3 h-3 mr-1" /> Tone Analysis
                   </div>
                   {expandedSections.tone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {expandedSections.tone && (
                  <p className="text-sm text-neutral-300 italic border-l-2 border-volt-text pl-3 animate-in slide-in-from-top-1 fade-in duration-200">
                      "{analysisResult.toneAudit}"
                  </p>
                )}
              </div>

              {/* Trigger Words */}
              {analysisResult.triggerWords.length > 0 && (
                <div className="border-b border-white/10 pb-4">
                  <button
                    onClick={() => toggleSection('triggers')}
                    className="w-full flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase mb-2 hover:text-neutral-300 transition-colors"
                  >
                    <div className="flex items-center">
                       <AlertTriangle className="w-3 h-3 mr-1" /> Trigger Words ({analysisResult.triggerWords.length})
                    </div>
                    {expandedSections.triggers ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {expandedSections.triggers && (
                      <div className="flex flex-wrap gap-1.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        {analysisResult.triggerWords.map((word, i) => (
                          <span key={i} className="px-2 py-1 bg-red-500/15 text-red-400 text-xs rounded-full border border-red-500/25">
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
                    className="w-full flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase mb-3 hover:text-neutral-300 transition-colors"
                  >
                     <div className="flex items-center">
                        <Lightbulb className="w-3 h-3 mr-1 text-volt-text" /> Smart Improvements
                     </div>
                     {expandedSections.suggestions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {expandedSections.suggestions && (
                      <ul className="space-y-2.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        {analysisResult.suggestions.map((suggestion, i) => (
                          <li key={i} className="flex items-start group">
                            <div className="mt-0.5 mr-2.5 flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center border border-amber-500/25">
                              <Lightbulb className="w-3 h-3 text-amber-400" />
                            </div>
                            <span className="text-xs text-neutral-300 leading-relaxed group-hover:text-white transition-colors">{suggestion}</span>
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
      <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/[0.02] backdrop-blur-sm sticky top-0 z-10">
        <div className="animate-in fade-in slide-in-from-left-2 duration-500">
          <h2 className="text-lg font-semibold text-white">Compose Follow-Up</h2>
          <p className="text-sm text-neutral-400">Drafting for <span className="font-medium text-neutral-300">{email.recipientName}</span></p>
        </div>
        <button onClick={onClose} aria-label="Close compose panel" className="text-neutral-400 hover:text-white transition-transform hover:rotate-90 p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* SECTION: CONTEXT & HISTORY */}
        <div className="space-y-4">
          
          {/* Follow-up History Block */}
          {email.followUpHistory && email.followUpHistory.length > 0 && (
            <div className="bg-white/[0.02] rounded-2xl border border-white/10 overflow-hidden animate-in fade-in slide-in-from-top-2">
              <div className="px-4 py-2 bg-white/[0.02] border-b border-white/10 flex items-center">
                 <History className="w-4 h-4 text-volt-text mr-2" />
                 <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Conversation History</h4>
              </div>
              <div className="p-4 space-y-4">
                  {email.followUpHistory.map((item, idx) => (
                    <div key={idx} className="relative pl-5 group">
                       {/* Timeline Line */}
                       {idx !== (email.followUpHistory!.length - 1) && (
                          <div className="absolute left-[5px] top-2.5 bottom-[-20px] w-px bg-white/10" />
                       )}

                       <div className={`absolute -left-[1px] top-1.5 w-3 h-3 rounded-full border-2 border-noir ${item.status === 'SENT' ? 'bg-emerald-500' : 'bg-purple-500'}`} />

                       <div className="flex justify-between items-start mb-1">
                          <span className={`text-xs font-semibold ${item.status === 'SENT' ? 'text-emerald-400' : 'text-purple-400'}`}>
                            {item.status === 'SENT' ? 'Follow-up Sent' : 'Scheduled'}
                          </span>
                          <span className="text-[10px] text-neutral-500 font-mono bg-white/[0.03] px-1.5 py-0.5 rounded-full border border-white/10">
                            {new Date(item.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                          </span>
                       </div>
                       <p className="text-xs text-neutral-400 bg-white/[0.03] p-2 rounded-xl border border-white/10 italic">
                         "{item.content.length > 120 ? item.content.substring(0, 120) + '...' : item.content}"
                       </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Original Context Block */}
          <div className="bg-white/[0.02] rounded-2xl border border-white/10 overflow-hidden">
             <div className="px-4 py-2 bg-white/[0.02] border-b border-white/10 flex items-center justify-between group cursor-default">
                <div className="flex items-center">
                  <Quote className="w-4 h-4 text-neutral-500 mr-2" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Original Email</h4>
                </div>
                <span className="text-[10px] text-neutral-500">{new Date(email.date).toLocaleDateString()}</span>
             </div>
             <div className="p-4">
                <p className="text-white font-semibold text-sm mb-2">{email.subject}</p>
                <div className="text-neutral-400 text-xs leading-relaxed bg-white/[0.03] p-3 rounded-xl border border-white/10 max-h-32 overflow-y-auto custom-scrollbar">
                   {email.body}
                </div>
             </div>
          </div>
        </div>

        <div className="border-t border-white/10" />

        {/* SECTION: DRAFTING WORKSPACE */}
        <div className="space-y-6">
          <div className="flex items-center space-x-2">
            <Wand2 className="w-5 h-5 text-volt-text" />
            <h3 className="text-base font-semibold text-white">Draft Response</h3>
          </div>

          {/* Controls - Always visible to allow regeneration */}
          <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Select Tone</label>
                <div className="flex flex-wrap gap-2">
                  {Object.values(FollowUpTone).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`px-4 py-2 text-sm rounded-full border transition-all active:scale-95 ${
                        tone === t
                          ? 'bg-volt/15 border-volt-text/40 text-volt-text font-medium'
                          : 'bg-white/[0.03] border-white/10 text-neutral-400 hover:border-white/16 hover:bg-white/[0.06]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Specific Instructions (Optional)</label>
                <textarea
                  className="w-full p-3 text-sm border border-white/10 rounded-xl focus:outline-none focus:border-volt-text resize-none h-24 transition-colors bg-white/[0.03] text-white placeholder:text-neutral-500"
                  placeholder="e.g., Mention the discount expires on Friday, keep it under 50 words..."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex-1 flex items-center justify-center space-x-2 py-3.5 bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)] text-white rounded-full transition-all disabled:opacity-70 active:scale-[0.99]"
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
                      className="flex items-center justify-center px-5 py-3.5 bg-white/[0.03] border border-white/10 text-neutral-300 rounded-full hover:bg-white/[0.06] hover:border-white/16 transition-all active:scale-95"
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
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-4 rounded-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h3 className="text-sm font-medium text-white flex items-center">
                    <Edit3 className="w-4 h-4 mr-2 text-volt-text" />
                    Editor
                  </h3>
                  <div className="flex items-center space-x-3">
                     {/* Added Warning */}
                     {analysisResult && analysisResult.score < 70 && (
                        <span className="hidden sm:flex text-xs font-medium text-amber-400 items-center animate-pulse mr-2">
                          <AlertTriangle className="w-3 h-3 mr-1" /> High Risk
                        </span>
                     )}
                     <button
                        type="button"
                        onClick={handleAnalysisToggle}
                        disabled={isAnalyzing}
                        className={`text-xs flex items-center transition-colors ${
                            analysisResult
                            ? 'text-neutral-300 hover:text-volt-text font-medium'
                            : 'text-volt-text hover:text-white disabled:opacity-50'
                        }`}
                      >
                         {isAnalyzing ? (
                             <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                         ) : (
                             <ShieldCheck className={`w-3 h-3 mr-1 ${analysisResult ? 'text-volt-text' : ''}`} />
                         )}
                         {isAnalyzing ? 'Checking...' : analysisResult ? 'View Analysis' : 'Check Spam Score'}
                      </button>
                      <div className="h-3 w-px bg-white/10" />
                      <button
                        onClick={handleGenerate}
                        className="text-xs text-volt-text hover:text-white flex items-center hover:underline"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                      </button>
                  </div>
              </div>

              <div className="space-y-4 group">
                <div className="space-y-1 mb-2">
                   <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Subject</label>
                       <button
                          onClick={handleCopySubject}
                          className={`text-xs flex items-center gap-1 transition-colors ${subjectCopied ? 'text-green-400' : 'text-neutral-400 hover:text-volt-text'}`}
                        >
                          {subjectCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {subjectCopied ? 'Copied' : 'Copy'}
                        </button>
                   </div>
                   <div className="relative group">
                      <input
                        value={draft.subject}
                        onChange={handleSubjectChange}
                        className="w-full px-3 py-2 border border-white/10 rounded-xl bg-white/[0.03] text-white text-sm font-medium focus:outline-none focus:border-volt-text transition-colors group-hover:border-white/16"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                         <Edit3 className="w-3 h-3 text-neutral-500" />
                      </div>
                   </div>
                </div>

                <div className="relative">
                  <textarea
                    value={draft.body}
                    onChange={handleBodyChange}
                    className="w-full h-64 text-neutral-300 leading-relaxed outline-none resize-none bg-white/[0.03] p-4 rounded-xl border border-white/10 focus:border-volt-text transition-colors text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {draft && (
          <div className="p-6 border-t border-white/10 bg-white/[0.02] flex flex-col space-y-3 animate-in slide-in-from-bottom-full duration-500 delay-100 z-20">
            {/* Scheduling UI */}
            {isScheduling && (
              <div className="bg-purple-500/10 border border-purple-500/25 p-4 rounded-2xl animate-in slide-in-from-bottom-2 mb-2">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-purple-300 uppercase tracking-wide flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> Auto-Schedule Follow-Up
                  </span>
                  <button
                    onClick={() => setIsScheduling(false)}
                    aria-label="Close scheduling"
                    className="text-neutral-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {settings.useRealApi && (
                  <div className="flex items-center text-xs text-amber-400 bg-amber-500/15 p-2 rounded-xl border border-amber-500/25 mb-3">
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
                        className={`px-2 py-1.5 text-xs border rounded-full transition-all font-medium active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isActive
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'bg-white/[0.03] border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:border-purple-400/40'
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
                    <label className="absolute -top-1.5 left-2 bg-noir px-1 text-[10px] font-medium text-neutral-400 leading-none">
                      Delay (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={sendDelay}
                      onChange={handleDelayChange}
                      disabled={settings.useRealApi}
                      className="w-full p-2 text-sm border border-purple-500/30 rounded-xl text-neutral-200 bg-white/[0.03] focus:outline-none focus:border-purple-400 transition-colors disabled:opacity-50"
                    />
                  </div>

                  <div className="flex-1">
                    <input
                      type="date"
                      min={new Date().toISOString().split('T')[0]}
                      value={scheduledDate}
                      onChange={handleDateChange}
                      disabled={settings.useRealApi}
                      className="w-full p-2 text-sm border border-purple-500/30 rounded-xl text-neutral-200 bg-white/[0.03] focus:outline-none focus:border-purple-400 transition-colors disabled:opacity-50 [color-scheme:dark]"
                    />
                  </div>

                  <button
                    onClick={initiateSchedule}
                    disabled={isProcessing || !scheduledDate || settings.useRealApi}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-full hover:bg-purple-500 transition-all flex items-center disabled:opacity-50 whitespace-nowrap active:scale-95 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-1" />
                    )}
                    Confirm Schedule
                  </button>
                </div>

                <p className="text-xs text-purple-300/80 mt-3 font-medium animate-in fade-in">
                  {scheduledDate ? (
                    <>
                      Follow-up set for{' '}
                      <span className="font-semibold underline decoration-purple-500/60">
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
                className="text-neutral-400 hover:text-white text-sm font-medium transition-colors hover:underline"
              >
                Cancel
              </button>

              <div className="flex space-x-3">
                <button
                  className="flex items-center px-4 py-2 bg-white/[0.03] border border-white/10 rounded-full text-neutral-300 text-sm font-medium hover:bg-white/[0.06] hover:border-white/16 transition-all active:scale-95"
                  onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All
                </button>

                {!isScheduling && (
                  <button
                    onClick={() => setIsScheduling(true)}
                    className="flex items-center px-4 py-2 bg-purple-500/10 border border-purple-500/25 text-purple-300 hover:bg-purple-500/20 hover:border-purple-400/40 rounded-full text-sm font-medium transition-all active:scale-95"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Schedule
                  </button>
                )}

                {!isScheduling && (
                  <button
                    onClick={initiateSend}
                    disabled={isProcessing}
                    className="flex items-center px-6 py-2 bg-volt text-white rounded-full text-sm font-medium transition-all disabled:opacity-70 active:scale-95 hover:shadow-[0_0_20px_rgb(2_1_255/0.55)]"
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
