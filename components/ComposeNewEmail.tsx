
import React, { useState, useEffect } from 'react';
import { X, Send, Wand2, Settings, Plus, Trash2, HelpCircle, Loader2, Sparkles, AlertCircle, User, Users, ArrowRight, Lightbulb, CalendarClock, Clock, AlertTriangle } from 'lucide-react';
import { AutoFollowUp, CampaignSettings, Recipient, Campaign } from '../types';
import { parseSmartCampaign } from '../services/gemini';
import { useSettings } from '../context/SettingsContext';
import { useNotification } from '../context/NotificationContext';

interface ComposeNewEmailProps {
  onClose: () => void;
  onSend: (campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats'>) => void;
  initialRecipientEmail?: string;
  initialRecipientName?: string;
  initialCompany?: string;
}

const SMART_TEMPLATES = [
  "Cold outreach to a CEO regarding video editing services. Follow up in 3 days.",
  "Networking invite to a marketing director at TechCorp.",
  "Proposal follow-up. Gentle nudge after 4 days, then a breakup email after 7 days.",
  "Re-engagement for old leads. Ask if they are still interested in growing their channel."
];

const ComposeNewEmail: React.FC<ComposeNewEmailProps> = ({ 
  onClose, 
  onSend, 
  initialRecipientEmail = '', 
  initialRecipientName = '', 
  initialCompany = '' 
}) => {
  const { settings } = useSettings();
  const { showToast } = useNotification();
  const [activeTab, setActiveTab] = useState<'MANUAL' | 'SMART'>('MANUAL');
  
  // Recipients State
  const [recipients, setRecipients] = useState<Recipient[]>(
    initialRecipientEmail ? [{ email: initialRecipientEmail, name: initialRecipientName, company: initialCompany }] : []
  );
  
  // Temp Recipient Input State
  const [tempRecipient, setTempRecipient] = useState<Recipient>({ email: '', name: '', company: '' });

  // Form State
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [autoFollowUps, setAutoFollowUps] = useState<AutoFollowUp[]>([]);
  const [distributionMethod, setDistributionMethod] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  
  // Scheduling State
  const [scheduledAt, setScheduledAt] = useState('');

  // Smart Compose State
  const [smartPrompt, setSmartPrompt] = useState('');
  const [isProcessingSmart, setIsProcessingSmart] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [campaignSettings, setCampaignSettings] = useState<CampaignSettings>({
    accounts: [],
    stopOnReply: true,
    openTracking: true,
    linkTracking: true,
    textOnly: false,
    firstEmailTextOnly: false,
    dailyLimit: 50,
    stopOnAutoReply: true,
    unsubscribeHeader: true,
    allowRisky: false,
    disableBounceProtect: false,
    prioritizeNewLeads: false
  });

  const handleAddRecipient = () => {
    if (tempRecipient.email) {
      setRecipients([...recipients, tempRecipient]);
      setTempRecipient({ email: '', name: '', company: '' });
    }
  };

  const removeRecipient = (index: number) => {
    const newRecipients = [...recipients];
    newRecipients.splice(index, 1);
    setRecipients(newRecipients);
  };

  const handleSmartParse = async () => {
    if (!smartPrompt.trim()) return;
    setIsProcessingSmart(true);
    setProcessingStep('Analyzing intent...');
    
    try {
      // Simulate steps for UX
      setTimeout(() => setProcessingStep('Drafting email content...'), 800);
      setTimeout(() => setProcessingStep('Scheduling follow-ups...'), 1800);

      const result = await parseSmartCampaign(smartPrompt);
      
      // Artificial delay to let user see the steps
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (result.recipientEmail) {
        setRecipients(prev => [
          ...prev, 
          { 
            email: result.recipientEmail || '', 
            name: result.recipientName || '', 
            company: '' 
          }
        ]);
      }
      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);
      
      if (result.followUps && result.followUps.length > 0) {
        setAutoFollowUps(result.followUps.map(f => ({
          content: f.content,
          delay: f.delay || 3,
          unit: f.unit || 'DAYS'
        })));
      }
      
      setActiveTab('MANUAL'); // Switch to manual view to review
    } catch (e) {
      console.error(e);
      showToast('ERROR', "Failed to generate campaign. Please try again.");
    } finally {
      setIsProcessingSmart(false);
      setProcessingStep('');
    }
  };

  const handleAddFollowUp = () => {
    setAutoFollowUps([...autoFollowUps, { delay: 3, unit: 'DAYS', content: '' }]);
  };

  const updateFollowUp = (index: number, field: keyof AutoFollowUp, value: any) => {
    const newFollowUps = [...autoFollowUps];
    // @ts-ignore
    newFollowUps[index][field] = value;
    setAutoFollowUps(newFollowUps);
  };

  const removeFollowUp = (index: number) => {
    setAutoFollowUps(autoFollowUps.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    // Validation
    if (recipients.length === 0) {
      showToast('ERROR', "Please add at least one recipient to start a campaign.");
      return;
    }
    if (!subject.trim()) {
        showToast('ERROR', "Please enter a subject line.");
        return;
    }
    if (!body.trim()) {
        showToast('ERROR', "Please enter the email body content.");
        return;
    }
    
    // Prevent scheduling in real API mode if user managed to bypass UI
    if (settings.useRealApi && scheduledAt) {
        showToast('ERROR', "Scheduling is not supported in Client-Side mode (requires backend).");
        return;
    }
    
    onSend({
      name: subject, // Use subject as default campaign name
      recipients,
      subject,
      body,
      scheduledAt: scheduledAt || new Date().toISOString(),
      distributionMethod,
      autoFollowUps
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[90vh] animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center">
              Start Campaign
              <span className="ml-3 text-xs font-normal text-slate-500 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">New Outreach</span>
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-6">
            
            {/* Tab Switcher */}
            <div className="flex space-x-4 mb-6">
               <button 
                 onClick={() => setActiveTab('MANUAL')}
                 className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'MANUAL' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
               >
                 Composer
               </button>
               <button 
                 onClick={() => setActiveTab('SMART')}
                 className={`pb-2 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'SMART' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
               >
                 <Sparkles className="w-3 h-3 mr-1.5" />
                 Smart Compose (Gemini)
               </button>
            </div>

            {activeTab === 'SMART' ? (
              <div className="flex-1 flex flex-col animate-in slide-in-from-right-4 duration-300">
                 <div className="bg-brand-50 dark:bg-brand-900/10 border border-brand-100 dark:border-brand-900/30 rounded-xl p-6 mb-4 relative overflow-hidden">
                    {isProcessingSmart && (
                       <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                          <div className="relative">
                             <div className="w-16 h-16 border-4 border-brand-200 dark:border-brand-800 rounded-full animate-spin border-t-brand-600 dark:border-t-brand-400"></div>
                             <div className="absolute inset-0 flex items-center justify-center">
                                <Sparkles className="w-6 h-6 text-brand-600 dark:text-brand-400 animate-pulse" />
                             </div>
                          </div>
                          <p className="mt-4 text-brand-800 dark:text-brand-200 font-medium animate-pulse">{processingStep}</p>
                       </div>
                    )}

                    <div className="flex items-center justify-between mb-4">
                       <div>
                          <h3 className="text-brand-800 dark:text-brand-300 font-bold text-lg flex items-center">
                             <Wand2 className="w-5 h-5 mr-2" />
                             Describe your campaign
                          </h3>
                          <p className="text-brand-600 dark:text-brand-400 text-sm mt-1">
                             Gemini will extract the recipient, subject, body, and schedule follow-ups automatically.
                          </p>
                       </div>
                    </div>

                    <textarea 
                      value={smartPrompt}
                      onChange={(e) => setSmartPrompt(e.target.value)}
                      placeholder="e.g. Send an email to elon@tesla.com asking about the Cybertruck delivery. Follow up in 3 days if no reply asking if he got the previous email."
                      className="w-full h-40 p-4 rounded-lg border-brand-200 dark:border-brand-800 focus:ring-brand-500 focus:border-brand-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white resize-none shadow-inner text-sm leading-relaxed"
                    />
                    
                    <div className="mt-4 flex flex-wrap gap-2">
                       {SMART_TEMPLATES.map((temp, i) => (
                          <button 
                            key={i}
                            onClick={() => setSmartPrompt(temp)}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-brand-100 dark:border-brand-800/50 rounded-full text-xs text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 hover:border-brand-200 transition-all flex items-center"
                          >
                             <Lightbulb className="w-3 h-3 mr-1.5" />
                             {temp.substring(0, 30)}...
                          </button>
                       ))}
                    </div>

                    <div className="mt-6 flex justify-end">
                       <button 
                         onClick={handleSmartParse}
                         disabled={isProcessingSmart || !smartPrompt}
                         className="px-6 py-2.5 bg-brand-600 text-white rounded-lg font-bold shadow-lg shadow-brand-500/20 hover:bg-brand-700 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center"
                       >
                          {isProcessingSmart ? 'Processing...' : (
                             <>
                                Generate Campaign <ArrowRight className="w-4 h-4 ml-2" />
                             </>
                          )}
                       </button>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50">
                       <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center mb-3">
                          <User className="w-4 h-4" />
                       </div>
                       <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">Recipient Extraction</h4>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Automatically identifies names, emails, and companies from unstructured text.</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50">
                       <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg flex items-center justify-center mb-3">
                          <Sparkles className="w-4 h-4" />
                       </div>
                       <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">AI Copywriting</h4>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Generates professional subject lines and body copy tailored to your goal.</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50">
                       <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center mb-3">
                          <Settings className="w-4 h-4" />
                       </div>
                       <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">Smart Scheduling</h4>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Detects timing preferences (e.g. "next week") and sets up auto-followups.</p>
                    </div>
                 </div>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                
                {/* Recipients Section */}
                <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                   <div className="flex justify-between items-center mb-3">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center">
                         <Users className="w-4 h-4 mr-2" /> Recipients ({recipients.length})
                      </label>
                      <span className="text-[10px] text-slate-400">Add multiple leads for bulk outreach</span>
                   </div>
                   
                   {/* Add Recipient Form */}
                   <div className="grid grid-cols-1 md:grid-cols-7 gap-2 mb-4">
                      <div className="md:col-span-3">
                         <input 
                           value={tempRecipient.email}
                           onChange={(e) => setTempRecipient({...tempRecipient, email: e.target.value})}
                           placeholder="Email"
                           className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none"
                         />
                      </div>
                      <div className="md:col-span-2">
                         <input 
                           value={tempRecipient.name}
                           onChange={(e) => setTempRecipient({...tempRecipient, name: e.target.value})}
                           placeholder="Name"
                           className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none"
                         />
                      </div>
                      <div className="md:col-span-2 flex gap-2">
                         <input 
                           value={tempRecipient.company}
                           onChange={(e) => setTempRecipient({...tempRecipient, company: e.target.value})}
                           placeholder="Company"
                           className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none"
                         />
                         <button 
                           onClick={handleAddRecipient}
                           disabled={!tempRecipient.email}
                           className="p-2 bg-slate-200 dark:bg-slate-700 hover:bg-brand-600 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                         >
                            <Plus className="w-4 h-4" />
                         </button>
                      </div>
                   </div>

                   {/* Recipients List */}
                   {recipients.length > 0 && (
                      <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
                         {recipients.map((r, i) => (
                            <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                               <div className="text-xs">
                                  <span className="font-bold text-slate-800 dark:text-white mr-2">{r.name || 'Unknown'}</span>
                                  <span className="text-slate-500 dark:text-slate-400 mr-2">&lt;{r.email}&gt;</span>
                                  {r.company && <span className="text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-1.5 rounded">{r.company}</span>}
                               </div>
                               <button onClick={() => removeRecipient(i)} className="text-slate-400 hover:text-red-500">
                                  <Trash2 className="w-3 h-3" />
                               </button>
                            </div>
                         ))}
                      </div>
                   )}
                </div>

                {/* Distribution Method Selector */}
                <div>
                   <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Distribution Method</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div 
                        onClick={() => setDistributionMethod('INDIVIDUAL')}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${distributionMethod === 'INDIVIDUAL' ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-500 ring-1 ring-brand-500' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700'}`}
                      >
                          <div className="flex items-center mb-1">
                             <User className={`w-4 h-4 mr-2 ${distributionMethod === 'INDIVIDUAL' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400'}`} />
                             <span className={`text-sm font-bold ${distributionMethod === 'INDIVIDUAL' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-300'}`}>Individual Emails</span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">Each lead receives a unique, personal email. (Best for outreach)</p>
                      </div>

                      <div 
                        onClick={() => setDistributionMethod('GROUP')}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${distributionMethod === 'GROUP' ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-500 ring-1 ring-brand-500' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700'}`}
                      >
                          <div className="flex items-center mb-1">
                             <Users className={`w-4 h-4 mr-2 ${distributionMethod === 'GROUP' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400'}`} />
                             <span className={`text-sm font-bold ${distributionMethod === 'GROUP' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-300'}`}>Group Thread</span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">All recipients are included in one email thread (CC/BCC).</p>
                      </div>
                   </div>
                </div>

                {/* Subject */}
                <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Subject</label>
                    <input 
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject line..."
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none font-medium"
                    />
                </div>

                {/* Body */}
                <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Email Body</label>
                    <textarea 
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Hi {Name}, ..."
                      className="w-full h-48 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none resize-none"
                    />
                </div>

                {/* Scheduling Section (New) */}
                <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/30 rounded-xl p-4">
                   <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase flex items-center">
                         <CalendarClock className="w-4 h-4 mr-2" /> Schedule Campaign
                      </label>
                      <span className="text-[10px] bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-purple-100 dark:border-purple-800 text-purple-600 dark:text-purple-400 font-medium">
                         Defaults to Eastern Standard Time (EST)
                      </span>
                   </div>
                   {settings.useRealApi && (
                      <div className="flex items-center text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded border border-amber-200 dark:border-amber-800 mb-2">
                        <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
                        <span>Scheduling is not supported in Client-Side mode (requires backend).</span>
                      </div>
                   )}
                   <input 
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      disabled={settings.useRealApi}
                      className="w-full p-2.5 text-sm border border-purple-200 dark:border-purple-800 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-purple-500 outline-none text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                   />
                   <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      Leave blank to send immediately.
                   </p>
                </div>

                {/* Auto Follow-Ups */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                   <div className="flex justify-between items-center mb-4">
                      <div className="flex flex-col sm:flex-row sm:items-center">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center mr-3">
                          <Send className="w-4 h-4 mr-2 text-slate-400" />
                          Auto Follow-ups
                        </h3>
                        <span className="mt-1 sm:mt-0 text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                           {distributionMethod === 'INDIVIDUAL' ? 'Sequences are scheduled individually for each lead.' : 'Follow-ups will be sent to the single group thread.'}
                        </span>
                      </div>
                      <button 
                        onClick={handleAddFollowUp}
                        className="text-xs flex items-center text-brand-600 dark:text-brand-400 hover:text-brand-800 font-medium"
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add Step
                      </button>
                   </div>
                   
                   <div className="space-y-3">
                      {autoFollowUps.map((followUp, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 rounded-lg p-3 animate-in slide-in-from-top-2">
                           <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-slate-500 uppercase">Step {idx + 1}: Follow-up</span>
                              <div className="flex items-center space-x-2">
                                 <span className="text-xs text-slate-400">Wait</span>
                                 <input 
                                   type="number" 
                                   className="w-14 p-1 text-center text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                                   value={followUp.delay}
                                   onChange={(e) => updateFollowUp(idx, 'delay', parseInt(e.target.value))}
                                 />
                                 <select
                                    className="p-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none"
                                    value={followUp.unit}
                                    onChange={(e) => updateFollowUp(idx, 'unit', e.target.value)}
                                 >
                                    <option value="MINUTES">Minutes</option>
                                    <option value="HOURS">Hours</option>
                                    <option value="DAYS">Days</option>
                                    <option value="WEEKS">Weeks</option>
                                 </select>
                                 <button onClick={() => removeFollowUp(idx)} className="ml-2 text-slate-400 hover:text-red-500">
                                    <Trash2 className="w-3 h-3" />
                                 </button>
                              </div>
                           </div>
                           <textarea 
                             className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 focus:ring-1 focus:ring-brand-500 outline-none h-24 resize-none"
                             placeholder="Follow-up content..."
                             value={followUp.content}
                             onChange={(e) => updateFollowUp(idx, 'content', e.target.value)}
                           />
                        </div>
                      ))}
                      {autoFollowUps.length === 0 && (
                        <div className="text-center py-4 text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                           No follow-ups configured.
                        </div>
                      )}
                   </div>
                </div>
              </div>
            )}
          </div>

          {/* Settings Sidebar (Collapsible) */}
          {showSettings && (
             <div className="w-72 bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 p-6 overflow-y-auto animate-in slide-in-from-right duration-300 shadow-xl">
                <div className="flex justify-between items-center mb-6">
                   <h3 className="font-bold text-slate-900 dark:text-white flex items-center">
                     <Settings className="w-4 h-4 mr-2" /> Settings
                   </h3>
                   <button onClick={() => setShowSettings(false)} className="md:hidden">
                     <X className="w-4 h-4" />
                   </button>
                </div>
                
                <div className="space-y-6">
                    <div>
                       <label className="flex items-center justify-between cursor-pointer mb-1">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Stop on Reply</span>
                          <input 
                            type="checkbox" 
                            checked={campaignSettings.stopOnReply}
                            onChange={(e) => setCampaignSettings({...campaignSettings, stopOnReply: e.target.checked})}
                            className="toggle"
                          />
                       </label>
                       <p className="text-[10px] text-slate-400">Halt sequence if lead replies.</p>
                    </div>

                    <div>
                       <label className="flex items-center justify-between cursor-pointer mb-1">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Open Tracking</span>
                          <input 
                            type="checkbox" 
                            checked={campaignSettings.openTracking}
                            onChange={(e) => setCampaignSettings({...campaignSettings, openTracking: e.target.checked})}
                            className="toggle"
                          />
                       </label>
                    </div>

                    <div>
                       <label className="flex items-center justify-between cursor-pointer mb-1">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Link Tracking</span>
                          <input 
                            type="checkbox" 
                            checked={campaignSettings.linkTracking}
                            onChange={(e) => setCampaignSettings({...campaignSettings, linkTracking: e.target.checked})}
                            className="toggle"
                          />
                       </label>
                    </div>
                    
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                       <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Risk Controls</h4>
                       
                       {/* Bounce Protection Section */}
                       <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm mb-3">
                        <div className="flex flex-col gap-3">
                            <div>
                                <h3 className="text-xs font-bold text-slate-900 dark:text-white">Allow Risky Emails</h3>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">Allow emails marked as risky.</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center justify-between cursor-pointer select-none group">
                                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">Enable Risky</span>
                                    <input
                                        type="checkbox"
                                        checked={campaignSettings.allowRisky}
                                        onChange={(e) => setCampaignSettings(prev => ({ ...prev, allowRisky: e.target.checked }))}
                                        className="w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                                    />
                                </label>
                                <label className="flex items-center justify-between cursor-pointer select-none group">
                                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">Disable BounceProtect</span>
                                    <input
                                        type="checkbox"
                                        checked={campaignSettings.disableBounceProtect}
                                        onChange={(e) => setCampaignSettings(prev => ({ ...prev, disableBounceProtect: e.target.checked }))}
                                        className="w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                                    />
                                </label>
                            </div>
                        </div>
                       </div>

                       {/* Prioritize New Leads Section */}
                       <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm">
                        <div className="flex flex-col gap-2">
                            <div>
                                <h3 className="text-xs font-bold text-slate-900 dark:text-white">New Leads Priority</h3>
                            </div>
                            <label className="flex items-start justify-between gap-2 cursor-pointer select-none group">
                                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors leading-snug">
                                    Prioritize new leads over follow-ups
                                </span>
                                <input
                                    type="checkbox"
                                    checked={campaignSettings.prioritizeNewLeads}
                                    onChange={(e) => setCampaignSettings(prev => ({ ...prev, prioritizeNewLeads: e.target.checked }))}
                                    className="w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500 mt-0.5 shrink-0"
                                />
                            </label>
                        </div>
                       </div>
                    </div>
                </div>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center">
           <button 
             onClick={() => setShowSettings(!showSettings)}
             className={`flex items-center text-sm font-medium transition-colors ${showSettings ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
           >
             <Settings className="w-4 h-4 mr-2" />
             Campaign Settings
           </button>
           <div className="flex space-x-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors">
                 Cancel
              </button>
              <button 
                onClick={handleSubmit}
                className="px-6 py-2 bg-brand-600 text-white rounded-lg font-bold shadow-md hover:bg-brand-700 transition-all flex items-center active:scale-95"
              >
                 <Send className="w-4 h-4 mr-2" />
                 {scheduledAt ? 'Schedule Campaign' : 'Launch Campaign'}
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default ComposeNewEmail;
