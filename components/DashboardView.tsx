
import React, { useState, useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useEmailProvider } from '../hooks/useEmailProvider';
import { Email, EmailStatus } from '../types';
import EmailCard from './EmailCard';
import { ComposeFollowUp } from './ComposeFollowUp';
import { Search, X, Filter, User, Calendar, AlertCircle, CalendarClock, CheckCircle2, Mail, RefreshCcw, RotateCcw, ChevronLeft } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';

interface DashboardViewProps {
  // Pass any necessary props or callbacks
}

export const DashboardView: React.FC<DashboardViewProps> = () => {
  const { settings } = useSettings();
  const { emails, loading, error: appError, loadEmails, sendFollowUp } = useEmailProvider();
  const { showToast } = useNotification();

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'NO_REPLY' | 'SCHEDULED' | 'REPLIED'>('NO_REPLY');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Advanced Filtering State
  const [showFilters, setShowFilters] = useState(false);
  const [senderFilter, setSenderFilter] = useState('');
  const [dateRange, setDateRange] = useState<{start: string, end: string}>({ start: '', end: '' });

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Stats calculation
  const stats = {
    total: emails.length,
    pending: emails.filter(e => e.status === EmailStatus.NO_REPLY || e.status === EmailStatus.FOLLOW_UP_DRAFTED).length,
    replied: emails.filter(e => e.status === EmailStatus.REPLIED).length,
    scheduled: emails.filter(e => e.status === EmailStatus.SCHEDULED).length
  };

  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  const filteredEmails = emails.filter(e => {
    let matches = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      matches = (
        e.recipientName.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        (e.company && e.company.toLowerCase().includes(q)) ||
        e.recipient.toLowerCase().includes(q)
      );
    } else {
      if (filter === 'NO_REPLY') {
        matches = e.status === EmailStatus.NO_REPLY || e.status === EmailStatus.FOLLOW_UP_DRAFTED;
      } else if (filter === 'SCHEDULED') {
        matches = e.status === EmailStatus.SCHEDULED;
      } else if (filter === 'REPLIED') {
        matches = e.status === EmailStatus.REPLIED;
      }
    }
    if (matches && senderFilter) {
      const s = senderFilter.toLowerCase();
      matches = e.recipientName.toLowerCase().includes(s) || e.recipient.toLowerCase().includes(s);
    }
    if (matches && dateRange.start) {
      matches = new Date(e.sentDate) >= new Date(dateRange.start);
    }
    if (matches && dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      matches = new Date(e.sentDate) <= endDate;
    }
    return matches;
  });

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isTyping && e.key !== 'Escape') return;

      switch (e.key.toLowerCase()) {
        case 'f': {
          if (selectedEmailId) e.preventDefault();
          break;
        }
        case '/': {
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        }
        case 'j': {
          e.preventDefault();
          if (filteredEmails.length === 0) return;
          const currentIndex = filteredEmails.findIndex(mail => mail.id === selectedEmailId);
          let nextIndex = 0;
          if (currentIndex === -1) {
            nextIndex = 0;
          } else if (currentIndex < filteredEmails.length - 1) {
            nextIndex = currentIndex + 1;
          } else {
            nextIndex = currentIndex;
          }
          setSelectedEmailId(filteredEmails[nextIndex].id);
          break;
        }
        case 'k': {
          e.preventDefault();
          if (filteredEmails.length === 0) return;
          const currentIndex = filteredEmails.findIndex(mail => mail.id === selectedEmailId);
          let prevIndex = 0;
          if (currentIndex === -1) {
            prevIndex = 0; 
          } else if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
          } else {
            prevIndex = 0;
          }
          setSelectedEmailId(filteredEmails[prevIndex].id);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredEmails, selectedEmailId]);

  const handleActionComplete = async (date?: string, content?: string) => {
    if (!selectedEmailId || !selectedEmail) return;
    
    const body = content || "Follow-up content";
    
    try {
      await sendFollowUp(selectedEmail, body, date);
      setSelectedEmailId(null);
      showToast('SUCCESS', date ? "Follow-up scheduled successfully." : "Follow-up sent successfully.");
    } catch (e: any) {
      showToast('ERROR', `Action failed: ${e.message}`);
    }
  };

  // Initial Load
  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  return (
    <div className="flex h-full flex-col">
      {/* Dashboard Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800/50 backdrop-blur-sm">
        <div 
          onClick={() => { setFilter('NO_REPLY'); setSearchQuery(''); }}
          className={`bg-slate-50 dark:bg-transparent p-3 md:p-4 flex items-center justify-between group hover:bg-white dark:hover:bg-slate-800/40 transition-all cursor-pointer animate-in slide-in-from-top-4 fade-in duration-500 ${filter === 'NO_REPLY' && !searchQuery ? 'bg-white dark:bg-slate-800/60 shadow-[inset_0_-2px_0_0_#0ea5e9] dark:shadow-[inset_0_-2px_0_0_#0ea5e9]' : ''}`} 
          style={{animationDelay: '0.1s'}}
        >
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase truncate">Pending</p>
            <p className="text-lg md:text-2xl font-bold text-amber-600 dark:text-amber-500 transition-transform group-hover:scale-105 origin-left">{stats.pending}</p>
          </div>
          <AlertCircle className="w-5 h-5 md:w-8 md:h-8 text-amber-200 dark:text-amber-900/30 group-hover:text-amber-400 transition-colors shrink-0 ml-2" />
        </div>
        <div 
          onClick={() => { setFilter('SCHEDULED'); setSearchQuery(''); }}
          className={`bg-slate-50 dark:bg-transparent p-3 md:p-4 flex items-center justify-between group hover:bg-white dark:hover:bg-slate-800/40 transition-all cursor-pointer animate-in slide-in-from-top-4 fade-in duration-500 ${filter === 'SCHEDULED' && !searchQuery ? 'bg-white dark:bg-slate-800/60 shadow-[inset_0_-2px_0_0_#a855f7] dark:shadow-[inset_0_-2px_0_0_#a855f7]' : ''}`} 
          style={{animationDelay: '0.2s'}}
        >
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase truncate">Scheduled</p>
            <p className="text-lg md:text-2xl font-bold text-purple-600 dark:text-purple-500 transition-transform group-hover:scale-105 origin-left">{stats.scheduled}</p>
          </div>
          <CalendarClock className="w-5 h-5 md:w-8 md:h-8 text-purple-200 dark:text-purple-900/30 group-hover:text-purple-400 transition-colors shrink-0 ml-2" />
        </div>
        <div 
          onClick={() => { setFilter('REPLIED'); setSearchQuery(''); }}
          className={`bg-slate-50 dark:bg-transparent p-3 md:p-4 flex items-center justify-between group hover:bg-white dark:hover:bg-slate-800/40 transition-all cursor-pointer animate-in slide-in-from-top-4 fade-in duration-500 ${filter === 'REPLIED' && !searchQuery ? 'bg-white dark:bg-slate-800/60 shadow-[inset_0_-2px_0_0_#22c55e] dark:shadow-[inset_0_-2px_0_0_#22c55e]' : ''}`} 
          style={{animationDelay: '0.3s'}}
        >
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase truncate">Replied</p>
            <p className="text-lg md:text-2xl font-bold text-green-600 dark:text-green-500 transition-transform group-hover:scale-105 origin-left">{stats.replied}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 md:w-8 md:h-8 text-green-200 dark:text-green-900/30 group-hover:text-green-400 transition-colors shrink-0 ml-2" />
        </div>
        <div 
          onClick={() => { setFilter('ALL'); setSearchQuery(''); }}
          className={`bg-slate-50 dark:bg-transparent p-3 md:p-4 flex items-center justify-between group hover:bg-white dark:hover:bg-slate-800/40 transition-all cursor-pointer animate-in slide-in-from-top-4 fade-in duration-500 ${filter === 'ALL' && !searchQuery ? 'bg-white dark:bg-slate-800/60 shadow-[inset_0_-2px_0_0_#64748b] dark:shadow-[inset_0_-2px_0_0_#64748b]' : ''}`} 
          style={{animationDelay: '0.4s'}}
        >
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase truncate">Total</p>
            <p className="text-lg md:text-2xl font-bold text-slate-700 dark:text-slate-300 transition-transform group-hover:scale-105 origin-left">{stats.total}</p>
          </div>
          <Mail className="w-5 h-5 md:w-8 md:h-8 text-slate-200 dark:text-slate-700/50 group-hover:text-slate-400 transition-colors shrink-0 ml-2" />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Panel: List View */}
        <div className={`${selectedEmailId ? 'hidden md:flex md:w-1/2 lg:w-2/5' : 'flex w-full'} border-r border-slate-200 dark:border-slate-800/50 flex-col bg-white dark:bg-transparent animate-in slide-in-from-left duration-300`}>
          <div className="p-3 md:p-4 border-b border-slate-200 dark:border-slate-800/50 bg-white dark:bg-slate-950/40 backdrop-blur-sm sticky top-0 z-10 shadow-sm dark:shadow-none">
            {/* Mobile Search Bar */}
            <div className="md:hidden mb-3 relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>

            <div className="flex space-x-2 mb-2 overflow-x-auto no-scrollbar pb-1 md:pb-0">
              {['NO_REPLY', 'SCHEDULED', 'REPLIED', 'ALL'].map((f) => (
                <button 
                  key={f}
                  onClick={() => { setFilter(f as any); setSearchQuery(''); }}
                  className={`flex-shrink-0 flex-1 text-xs font-medium px-3 py-1.5 rounded-md transition-all duration-200 active:scale-95 whitespace-nowrap ${filter === f && !searchQuery ? 'bg-slate-800 text-white shadow-md dark:bg-slate-800 dark:shadow-glow border border-transparent dark:border-slate-700' : 'bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                >
                  {f === 'NO_REPLY' ? 'Pending' : f === 'SCHEDULED' ? 'Sched' : f === 'REPLIED' ? 'Replied' : 'All'}
                </button>
              ))}
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`px-2.5 rounded-md transition-colors flex-shrink-0 ${showFilters || senderFilter || dateRange.start || dateRange.end ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800' : 'bg-slate-100 dark:bg-slate-800/50 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                title="Filter Options"
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>

            {(showFilters || senderFilter || dateRange.start || dateRange.end) && (
              <div className={`mb-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3 animate-in slide-in-from-top-2 text-sm ${!showFilters ? 'hidden' : ''}`}>
                <div className="flex items-center space-x-2">
                   <div className="w-8 h-8 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                     <User className="w-4 h-4 text-slate-400" />
                   </div>
                   <input 
                      type="text" 
                      placeholder="Filter by sender..."
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value)}
                      className="w-full p-1.5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-brand-500 text-slate-700 dark:text-slate-200 placeholder-slate-400"
                   />
                </div>
                <div className="flex items-center space-x-2">
                   <div className="w-8 h-8 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                     <Calendar className="w-4 h-4 text-slate-400" />
                   </div>
                   <div className="flex-1 flex items-center space-x-2">
                     <input 
                        type="date" 
                        value={dateRange.start}
                        onChange={(e) => setDateRange(prev => ({...prev, start: e.target.value}))}
                        className="w-full p-1.5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-brand-500 text-slate-700 dark:text-slate-200 text-xs"
                     />
                     <span className="text-slate-400">-</span>
                     <input 
                        type="date" 
                        value={dateRange.end}
                        onChange={(e) => setDateRange(prev => ({...prev, end: e.target.value}))}
                        className="w-full p-1.5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-brand-500 text-slate-700 dark:text-slate-200 text-xs"
                     />
                   </div>
                </div>
                {(senderFilter || dateRange.start || dateRange.end) && (
                  <button 
                    onClick={() => { setSenderFilter(''); setDateRange({start:'', end:''}); }}
                    className="w-full py-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-800/50 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    Clear Advanced Filters
                  </button>
                )}
              </div>
            )}

            {appError && (
              <div className="mt-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 p-3 rounded-lg text-xs flex items-start animate-in fade-in">
                <AlertCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">{appError.message}</p>
                </div>
              </div>
            )}

            {searchQuery && (
              <div className="mt-2 text-xs text-brand-600 dark:text-brand-400 font-medium flex items-center animate-in fade-in">
                <Search className="w-3 h-3 mr-1" />
                Results for "{searchQuery}"
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-transparent scroll-smooth custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-40 space-y-3 animate-pulse">
                <RefreshCcw className="w-6 h-6 text-brand-500 animate-spin" />
                <p className="text-sm text-slate-400">{settings.useRealApi ? (settings.activeProvider === 'GMAIL' ? 'Fetching from Gmail...' : 'Fetching from Zoho...') : 'Syncing...'}</p>
              </div>
            ) : (
              filteredEmails.map((email, index) => (
                <div key={email.id} style={{ animationDelay: `${index * 0.05}s` }} className="animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards">
                  <EmailCard 
                    email={email} 
                    isSelected={selectedEmailId === email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                  />
                </div>
              ))
            )}
            {!loading && filteredEmails.length === 0 && (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm animate-in fade-in zoom-in-95">
                {searchQuery 
                  ? 'No emails found matching your search.' 
                  : 'No emails found matching your filters.'}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Detail View */}
        <div className={`${selectedEmailId ? 'absolute inset-0 z-30 md:static md:w-1/2 lg:w-3/5 block' : 'hidden md:block md:w-1/2 lg:w-3/5'} bg-slate-50 dark:bg-transparent relative overflow-hidden flex flex-col`}>
          {selectedEmail ? (
            <div className="absolute inset-0 flex flex-col bg-white dark:bg-slate-950/90 backdrop-blur-md md:bg-transparent">
              <div className="flex-1 p-4 md:p-8 overflow-y-auto animate-in slide-in-from-right duration-300 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                {/* Mobile Back Button */}
                <button 
                  onClick={() => setSelectedEmailId(null)}
                  className="md:hidden mb-4 flex items-center text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white p-2 -ml-2 rounded-lg active:bg-slate-100 dark:active:bg-slate-800"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to List
                </button>

                <div className="bg-white dark:bg-slate-900/60 shadow-sm border border-slate-200 dark:border-slate-700/50 rounded-xl p-5 md:p-8 mb-6 transition-shadow hover:shadow-md">
                  <div className="flex justify-between items-start mb-6">
                      <div>
                        <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-2 leading-snug break-words">{selectedEmail.subject}</h2>
                        <div className="flex flex-wrap items-center text-sm text-slate-500 dark:text-slate-400 gap-y-1 gap-x-2">
                          <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 truncate max-w-[200px]">To: {selectedEmail.recipientName}</span>
                          <span className="hidden md:inline text-slate-300 dark:text-slate-600">•</span>
                          <span>{new Date(selectedEmail.sentDate).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="hidden md:block bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 px-3 py-1 rounded-full text-xs font-medium shadow-sm shrink-0 ml-2">
                        {selectedEmail.provider === 'GMAIL' ? 'Gmail' : selectedEmail.provider === 'ZOHO' ? 'Zoho' : 'Original'}
                      </div>
                  </div>
                  <div className="prose prose-slate dark:prose-invert prose-sm max-w-none text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed break-words">
                    {selectedEmail.body}
                  </div>
                </div>

                <div className="flex justify-center pb-24 md:pb-0">
                  <button 
                    className="hidden md:flex items-center space-x-2 text-slate-400 dark:text-slate-500 text-sm opacity-50 cursor-default"
                  >
                    <span>Email selected. Use panel to reply.</span>
                  </button>
                </div>
              </div>

              <div className="absolute inset-0 z-20 pointer-events-none">
                <div className="pointer-events-auto h-full">
                  <ComposeFollowUp 
                      email={selectedEmail} 
                      onClose={() => setSelectedEmailId(null)}
                      onComplete={handleActionComplete}
                      signature={settings.emailSignature}
                      defaultTone={settings.defaultTone}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-8 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-200/50 dark:bg-slate-800/30 rounded-full flex items-center justify-center mb-6 animate-bounce-slow backdrop-blur-sm">
                <Mail className="w-8 h-8 md:w-10 md:h-10 text-slate-400/70 dark:text-slate-500/70" />
              </div>
              <p className="text-base md:text-lg font-medium text-slate-600 dark:text-slate-300 text-center">Select an email to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
