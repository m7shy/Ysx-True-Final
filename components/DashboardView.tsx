
import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSettings } from '../context/SettingsContext';
import { useEmailProvider } from '../hooks/useEmailProvider';
import { Email, EmailStatus } from '../types';
import EmailCard from './EmailCard';
import { ComposeFollowUp } from './ComposeFollowUp';
import { Search, X, Filter, User, Calendar, AlertCircle, CalendarClock, CheckCircle2, Mail, RefreshCcw, RotateCcw, ChevronLeft } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { EASE, staggerDelay, MaskedReveal } from './motion/primitives';
import { Input, Button } from '../src/design/ui';

interface DashboardViewProps {
  // Pass any necessary props or callbacks
}

type StatKey = 'NO_REPLY' | 'SCHEDULED' | 'REPLIED' | 'ALL';

const STAT_CARDS: { key: StatKey; label: string; valueClass: string; icon: any; iconClass: string }[] = [
  { key: 'NO_REPLY', label: 'Pending', valueClass: 'text-amber-400', icon: AlertCircle, iconClass: 'text-amber-900/40 group-hover:text-amber-400' },
  { key: 'SCHEDULED', label: 'Scheduled', valueClass: 'text-purple-400', icon: CalendarClock, iconClass: 'text-purple-900/40 group-hover:text-purple-400' },
  { key: 'REPLIED', label: 'Replied', valueClass: 'text-green-400', icon: CheckCircle2, iconClass: 'text-green-900/40 group-hover:text-green-400' },
  { key: 'ALL', label: 'Total', valueClass: 'text-neutral-300', icon: Mail, iconClass: 'text-neutral-700/60 group-hover:text-neutral-400' },
];

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

  const statValue = (key: StatKey) =>
    key === 'NO_REPLY' ? stats.pending : key === 'SCHEDULED' ? stats.scheduled : key === 'REPLIED' ? stats.replied : stats.total;

  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  const filteredEmails = emails.filter(e => {
    let matches = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      matches = (
        (e.recipientName ?? '').toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        (e.company && e.company.toLowerCase().includes(q)) ||
        e.to.toLowerCase().includes(q)
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
      matches = (e.recipientName ?? '').toLowerCase().includes(s) || e.to.toLowerCase().includes(s);
    }
    if (matches && dateRange.start) {
      matches = new Date(e.date) >= new Date(dateRange.start);
    }
    if (matches && dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      matches = new Date(e.date) <= endDate;
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
      await sendFollowUp(selectedEmail, body);
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border-b border-white/10 backdrop-blur-sm">
        {STAT_CARDS.map((card, i) => {
          const isActive = filter === card.key && !searchQuery;
          const Icon = card.icon;
          return (
            <motion.button
              key={card.key}
              type="button"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.1 + i * 0.05 }}
              onClick={() => { setFilter(card.key); setSearchQuery(''); }}
              aria-pressed={isActive}
              className={`relative text-left bg-noir/60 p-3 md:p-4 flex items-center justify-between group hover:bg-white/[0.05] transition-colors duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt-text ${isActive ? 'bg-white/[0.05]' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs font-medium text-neutral-400 uppercase truncate">{card.label}</p>
                <p className={`text-lg md:text-2xl font-semibold ${card.valueClass} transition-transform group-hover:scale-105 origin-left duration-300`}>{statValue(card.key)}</p>
              </div>
              <Icon className={`w-5 h-5 md:w-8 md:h-8 ${card.iconClass} transition-colors duration-300 shrink-0 ml-2`} />
              {isActive && (
                <motion.div
                  layoutId="activeStatIndicator"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-volt shadow-glow"
                />
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Panel: List View */}
        <div className={`${selectedEmailId ? 'hidden md:flex md:w-1/2 lg:w-2/5' : 'flex w-full'} border-r border-white/10 flex-col bg-transparent`}>
          <div className="p-3 md:p-4 border-b border-white/10 bg-white/[0.02] backdrop-blur-sm sticky top-0 z-10">
            {/* Mobile Search Bar */}
            <div className="md:hidden mb-3 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 z-10" />
              <Input
                type="text"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex space-x-2 mb-2 overflow-x-auto no-scrollbar pb-1 md:pb-0">
              {(['NO_REPLY', 'SCHEDULED', 'REPLIED', 'ALL'] as const).map((f) => {
                const isActive = filter === f && !searchQuery;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => { setFilter(f); setSearchQuery(''); }}
                    aria-pressed={isActive}
                    className={`relative flex-shrink-0 flex-1 text-xs font-medium px-3 py-1.5 rounded-full transition-colors duration-300 active:scale-95 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${isActive ? 'text-white' : 'bg-white/[0.03] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200'}`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeQuickFilter"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                        className="absolute inset-0 rounded-full bg-white/[0.08] border border-white/10 shadow-glow"
                      />
                    )}
                    <span className="relative z-10">{f === 'NO_REPLY' ? 'Pending' : f === 'SCHEDULED' ? 'Sched' : f === 'REPLIED' ? 'Replied' : 'All'}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`px-2.5 rounded-full transition-colors duration-300 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${showFilters || senderFilter || dateRange.start || dateRange.end ? 'bg-volt/10 text-volt-text border border-volt/30' : 'bg-white/[0.03] text-neutral-500 hover:text-neutral-300'}`}
                title="Filter Options"
                aria-label="Toggle advanced filter options"
                aria-expanded={showFilters}
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {(showFilters || senderFilter || dateRange.start || dateRange.end) && showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="mb-2 bg-white/[0.03] rounded-2xl border border-white/10 p-3 space-y-3 text-sm">
                    <div className="flex items-center space-x-2">
                       <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/10 flex items-center justify-center shrink-0">
                         <User className="w-4 h-4 text-neutral-400" />
                       </div>
                       <input
                          type="text"
                          placeholder="Filter by sender..."
                          value={senderFilter}
                          onChange={(e) => setSenderFilter(e.target.value)}
                          className="w-full p-1.5 bg-white/[0.03] border border-white/10 rounded-lg outline-none focus:border-volt-text text-neutral-200 placeholder-neutral-500 transition-colors duration-300"
                       />
                    </div>
                    <div className="flex items-center space-x-2">
                       <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/10 flex items-center justify-center shrink-0">
                         <Calendar className="w-4 h-4 text-neutral-400" />
                       </div>
                       <div className="flex-1 flex items-center space-x-2">
                         <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange(prev => ({...prev, start: e.target.value}))}
                            className="w-full p-1.5 bg-white/[0.03] border border-white/10 rounded-lg outline-none focus:border-volt-text text-neutral-200 text-xs transition-colors duration-300"
                         />
                         <span className="text-neutral-500">-</span>
                         <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange(prev => ({...prev, end: e.target.value}))}
                            className="w-full p-1.5 bg-white/[0.03] border border-white/10 rounded-lg outline-none focus:border-volt-text text-neutral-200 text-xs transition-colors duration-300"
                         />
                       </div>
                    </div>
                    {(senderFilter || dateRange.start || dateRange.end) && (
                      <button
                        type="button"
                        onClick={() => { setSenderFilter(''); setDateRange({start:'', end:''}); }}
                        className="w-full py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-white/[0.03] rounded-lg hover:bg-white/[0.06] transition-colors duration-300"
                      >
                        Clear Advanced Filters
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {appError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 bg-red-500/10 border border-red-400/20 text-red-300 p-3 rounded-lg text-xs flex items-start"
              >
                <AlertCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">{appError.message}</p>
                </div>
              </motion.div>
            )}

            {searchQuery && (
              <div className="mt-2 text-xs text-volt-text font-medium flex items-center">
                <Search className="w-3 h-3 mr-1" />
                Results for "{searchQuery}"
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-transparent scroll-smooth custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-40 space-y-3 animate-pulse">
                <RefreshCcw className="w-6 h-6 text-volt-text animate-spin" />
                <p className="text-sm text-neutral-400">{settings.useRealApi ? (settings.activeProvider === 'GMAIL' ? 'Fetching from Gmail...' : 'Fetching from Zoho...') : 'Syncing...'}</p>
              </div>
            ) : (
              filteredEmails.map((email, index) => (
                <motion.div
                  key={email.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: EASE, delay: staggerDelay(index) }}
                >
                  <EmailCard
                    email={email}
                    isSelected={selectedEmailId === email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                  />
                </motion.div>
              ))
            )}
            {!loading && filteredEmails.length === 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="p-8 text-center text-neutral-400 text-sm"
              >
                {searchQuery
                  ? 'No emails found matching your search.'
                  : 'No emails found matching your filters.'}
              </motion.div>
            )}
          </div>
        </div>

        {/* Right Panel: Detail View */}
        <div className={`${selectedEmailId ? 'absolute inset-0 z-30 md:static md:w-1/2 lg:w-3/5 block' : 'hidden md:block md:w-1/2 lg:w-3/5'} bg-transparent relative overflow-hidden flex flex-col`}>
          <AnimatePresence mode="wait">
            {selectedEmail ? (
              <motion.div
                key={selectedEmail.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.3, ease: EASE }}
                className="absolute inset-0 flex flex-col bg-noir/90 backdrop-blur-md md:bg-transparent"
              >
                <div className="flex-1 p-4 md:p-8 overflow-y-auto custom-scrollbar">
                  {/* Mobile Back Button */}
                  <button
                    type="button"
                    onClick={() => setSelectedEmailId(null)}
                    className="md:hidden mb-4 flex items-center text-sm font-medium text-neutral-300 hover:text-white p-2 -ml-2 rounded-full active:bg-white/10 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back to List
                  </button>

                  <MaskedReveal className="glass rounded-2xl p-5 md:p-8 mb-6 transition-shadow duration-300 hover:shadow-glow">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                          <h2 className="text-lg md:text-xl font-semibold text-white mb-2 leading-snug break-words">{selectedEmail.subject}</h2>
                          <div className="flex flex-wrap items-center text-sm text-neutral-400 gap-y-1 gap-x-2">
                            <span className="bg-white/10 px-2 py-0.5 rounded text-neutral-300 truncate max-w-[200px]">To: {selectedEmail.recipientName}</span>
                            <span className="hidden md:inline text-neutral-600">•</span>
                            <span>{new Date(selectedEmail.date).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="hidden md:block bg-white/10 text-neutral-300 px-3 py-1 rounded-full text-xs font-medium shrink-0 ml-2">
                          {selectedEmail.provider === 'GMAIL' ? 'Gmail' : selectedEmail.provider === 'ZOHO' ? 'Zoho' : 'Original'}
                        </div>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none text-neutral-300 whitespace-pre-wrap leading-relaxed break-words">
                      {selectedEmail.body}
                    </div>
                  </MaskedReveal>

                  <div className="flex justify-center pb-24 md:pb-0">
                    <span
                      className="hidden md:flex items-center space-x-2 text-neutral-500 text-sm opacity-50"
                    >
                      Email selected. Use panel to reply.
                    </span>
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
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full flex flex-col items-center justify-center text-neutral-500 p-8"
              >
                <div className="w-16 h-16 md:w-20 md:h-20 bg-white/[0.03] border border-white/10 rounded-full flex items-center justify-center mb-6 backdrop-blur-sm">
                  <Mail className="w-8 h-8 md:w-10 md:h-10 text-neutral-500/70" />
                </div>
                <p className="text-base md:text-lg font-medium text-neutral-300 text-center">Select an email to view details</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
