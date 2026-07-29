import React, { useState, useEffect, useRef } from 'react';
import { Search, Send, Sparkles, ChevronDown, MessageSquare } from 'lucide-react';
import { Thread, ThreadStatus, ThreadLeadStatus } from '../types';
import { apiGet, apiPatch, apiPost, ApiError } from '../services/apiClient';
import { useNotification } from '../context/NotificationContext';
import { Input, Textarea, Button, Badge } from '../src/design/ui';

async function fetchInboxThreads(): Promise<Thread[]> {
  const data = await apiGet<{ threads: Thread[] }>('/api/unibox/threads');
  return data.threads;
}

async function sendReplyToThread(threadId: string, content: string): Promise<void> {
  await apiPost(`/api/unibox/threads/${threadId}/reply`, { content });
}

async function updateThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
  await apiPatch(`/api/unibox/threads/${threadId}/status`, { status });
}

async function updateThreadLeadStatus(threadId: string, leadStatus: ThreadLeadStatus): Promise<void> {
  await apiPatch(`/api/unibox/threads/${threadId}/lead-status`, { leadStatus });
}

export const UniboxView: React.FC = () => {
  const { showToast } = useNotification();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'INTERESTED'>('ALL');
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Ref for auto-scrolling to bottom of chat
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    loadThreads();
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [selectedThreadId, threads]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadThreads = async () => {
    if (isMounted.current) setIsLoading(true);
    try {
      const data = await fetchInboxThreads();
      if (isMounted.current) {
        setThreads(data);
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Failed to load threads", error);
      showToast('ERROR', "Failed to load inbox threads.");
      if (isMounted.current) setIsLoading(false);
    }
  };

  const handleSelectThread = async (thread: Thread) => {
    setSelectedThreadId(thread.id);
    if (thread.status === 'UNREAD') {
      try {
        // Mark as read locally and sync
        const updated = { ...thread, status: 'READ' as ThreadStatus };
        setThreads(prev => prev.map(t => t.id === thread.id ? updated : t));
        await updateThreadStatus(thread.id, 'READ');
      } catch (error) {
        console.error("Failed to update thread status", error);
        // Silently fail for read status or show minor toast
      }
    }
  };

  const handleSendReply = async () => {
    if (!selectedThreadId || !replyText.trim()) return;
    setIsSending(true);
    try {
      // The SEND and the REFRESH are reported separately on purpose. They used
      // to share one try/catch, so a refresh that failed after a reply had
      // already gone out surfaced as "Failed to send reply. Please try again."
      // — and trying again sends a second reply to a real prospect. The mail is
      // the irreversible half; a stale thread list is cosmetic.
      await sendReplyToThread(selectedThreadId, replyText);
    } catch (e) {
      // Show the server's reason. This route now refuses a send for three
      // reasons that "Please try again" is actively wrong about — the lead is
      // do-not-contact, the address unsubscribed, or the account has no postal
      // address configured yet (MISSING_SENDER_IDENTITY). Retrying cannot fix
      // any of them, and only the message says which it is.
      console.error("Failed to send reply", e);
      showToast('ERROR', e instanceof Error && e.message ? e.message : "Failed to send reply. Please try again.");
      if (isMounted.current) setIsSending(false);
      return;
    }

    if (isMounted.current) {
      setReplyText('');
      showToast('SUCCESS', "Reply sent successfully.");
    }

    try {
      const updatedThreads = await fetchInboxThreads();
      if (isMounted.current) setThreads(updatedThreads);
    } catch (e) {
      // The reply is already out. Say what is actually wrong rather than
      // implying the send failed.
      console.error("Reply sent, but refreshing the thread list failed", e);
      if (isMounted.current) {
        showToast('ERROR', "Reply sent, but the thread list could not refresh. Reload to see it.");
      }
    } finally {
      if (isMounted.current) setIsSending(false);
    }
  };

  const handleLeadStatusChange = async (newStatus: ThreadLeadStatus) => {
    if (!selectedThreadId) return;
    try {
      // Optimistic update
      setThreads(prev => prev.map(t => t.id === selectedThreadId ? { ...t, leadStatus: newStatus } : t));
      await updateThreadLeadStatus(selectedThreadId, newStatus);
    } catch (error) {
      console.error("Failed to update lead status", error);
      showToast('ERROR', "Failed to update lead status.");
      // Revert optimistic update (optional, but good practice)
      const original = threads.find(t => t.id === selectedThreadId);
      if (original && isMounted.current) {
         setThreads(prev => prev.map(t => t.id === selectedThreadId ? original : t));
      }
    }
  };

  const filteredThreads = threads.filter(t => {
    const matchesSearch = t.leadName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.leadCompany.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (filter === 'UNREAD') return t.status === 'UNREAD';
    if (filter === 'INTERESTED') return t.leadStatus === 'INTERESTED' || t.leadStatus === 'MEETING_BOOKED';

    return true;
  }).sort((a, b) => new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime());

  const selectedThread = threads.find(t => t.id === selectedThreadId);

  const getStatusVariant = (status: ThreadLeadStatus): 'success' | 'danger' | 'volt' | 'warning' | 'neutral' => {
    switch (status) {
      case 'INTERESTED': return 'success';
      case 'NOT_INTERESTED': return 'danger';
      case 'MEETING_BOOKED': return 'volt';
      case 'LEFT_HANGING': return 'warning';
      case 'DNC': return 'danger';
      default: return 'neutral';
    }
  };

  // Helper to format message date
  const formatMessageDate = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {month: 'short', day: 'numeric'});
  };

  return (
    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden bg-noir">

      {/* LEFT SIDEBAR: THREAD LIST */}
      <div className={`w-full md:w-80 lg:w-96 flex flex-col border-r border-white/10 bg-white/[0.02] ${selectedThreadId ? 'hidden md:flex' : 'flex'}`}>

        {/* Search & Filter Header */}
        <div className="p-4 border-b border-white/10">
           <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 z-10" />
              <Input
                type="text"
                placeholder="Search inbox..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
           </div>

           <div className="flex space-x-1 p-1 bg-white/[0.03] rounded-full">
              {['ALL', 'UNREAD', 'INTERESTED'].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f as any)}
                  aria-pressed={filter === f}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${
                    filter === f
                      ? 'bg-white/[0.08] text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {f === 'INTERESTED' ? 'HOT' : f}
                </button>
              ))}
           </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
           {isLoading ? (
             <div className="p-8 text-center text-neutral-400 text-sm">Loading threads...</div>
           ) : filteredThreads.length === 0 ? (
             <div className="p-8 text-center text-neutral-400 text-sm">No conversations found.</div>
           ) : (
             filteredThreads.map(thread => (
               <button
                 key={thread.id}
                 type="button"
                 onClick={() => handleSelectThread(thread)}
                 className={`w-full text-left p-4 border-b border-white/5 cursor-pointer hover:bg-white/[0.04] transition-colors relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt-text ${
                   selectedThreadId === thread.id ? 'bg-white/[0.05] shadow-[inset_3px_0_0_0_var(--color-volt-text)]' : ''
                 }`}
               >
                  <div className="flex justify-between items-start mb-1">
                     <h4 className={`text-sm font-semibold truncate pr-2 ${thread.status === 'UNREAD' ? 'text-white' : 'text-neutral-300'}`}>
                       {thread.leadName}
                     </h4>
                     <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                       {formatMessageDate(thread.lastMessageDate)}
                     </span>
                  </div>

                  <div className="text-xs text-neutral-400 truncate mb-1">
                     {thread.leadCompany}
                  </div>

                  <p className={`text-xs truncate ${thread.status === 'UNREAD' ? 'text-neutral-200 font-medium' : 'text-neutral-500'}`}>
                     {thread.messages[thread.messages.length - 1].content}
                  </p>

                  {thread.status === 'UNREAD' && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-2 h-2 bg-volt rounded-full shadow-glow" />
                  )}
               </button>
             ))
           )}
        </div>
      </div>

      {/* RIGHT PANEL: CONVERSATION */}
      <div className={`flex-1 flex flex-col bg-noir relative ${!selectedThreadId ? 'hidden md:flex' : 'flex'}`}>
         {!selectedThread ? (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 p-8">
               <div className="w-16 h-16 bg-white/[0.03] rounded-full flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-neutral-600" />
               </div>
               <p className="text-lg font-medium">Select a conversation</p>
            </div>
         ) : (
            <>
               {/* Header */}
               <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-noir sticky top-0 z-10">
                  <div className="flex items-center min-w-0">
                     <button
                       type="button"
                       onClick={() => setSelectedThreadId(null)}
                       className="md:hidden mr-3 text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text rounded-full"
                       aria-label="Back to thread list"
                     >
                        <ChevronDown className="w-5 h-5 rotate-90" />
                     </button>
                     <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center text-neutral-300 font-semibold mr-3 shrink-0">
                        {selectedThread.leadName.charAt(0)}
                     </div>
                     <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white truncate">
                           {selectedThread.leadName}
                        </h3>
                        <p className="text-xs text-neutral-400 truncate">
                           {selectedThread.leadCompany} • {selectedThread.subject}
                        </p>
                     </div>
                  </div>

                  <div className="flex items-center space-x-2">
                     <div className="relative group">
                        <button
                          type="button"
                          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text rounded-full"
                          aria-haspopup="menu"
                        >
                          <Badge variant={getStatusVariant(selectedThread.leadStatus)} className="cursor-pointer">
                             {selectedThread.leadStatus.replace('_', ' ')} <ChevronDown className="w-3 h-3 ml-1.5 inline" />
                          </Badge>
                        </button>

                        {/* Dropdown */}
                        <div className="absolute right-0 top-full mt-2 w-40 bg-noir/95 border border-white/10 backdrop-blur-xl rounded-2xl shadow-none py-1 hidden group-hover:block z-20" role="menu">
                           {['INTERESTED', 'NOT_INTERESTED', 'MEETING_BOOKED', 'LEFT_HANGING'].map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleLeadStatusChange(s as ThreadLeadStatus)}
                                className="block w-full text-left px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-white/[0.05]"
                              >
                                 {s.replace('_', ' ')}
                              </button>
                           ))}
                           <div className="my-1 border-t border-white/10" />
                           <button
                             type="button"
                             onClick={() => {
                                if (window.confirm('Mark as Do Not Contact? All queued campaign sends and follow-ups to this lead will be cancelled, and it will never be contacted by a campaign again.')) {
                                   handleLeadStatusChange('DNC');
                                }
                             }}
                             className="block w-full text-left px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                           >
                              DO NOT CONTACT
                           </button>
                        </div>
                     </div>
                   </div>
               </div>

               {/* Message Stream */}
               <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white/[0.01] custom-scrollbar">
                  {selectedThread.messages.map((msg, idx) => (
                     <div key={msg.id} className={`flex ${msg.sender === 'ME' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                           msg.sender === 'ME'
                             ? 'bg-volt text-white rounded-br-none'
                             : 'bg-white/[0.04] text-neutral-200 border border-white/10 rounded-bl-none'
                        }`}>
                           <p className="whitespace-pre-wrap">{msg.content}</p>
                           <p className={`text-[10px] mt-1.5 text-right opacity-70 ${msg.sender === 'ME' ? 'text-white/80' : 'text-neutral-400'}`}>
                              {new Date(msg.date).toLocaleString([], {weekday: 'short', hour: '2-digit', minute:'2-digit'})}
                           </p>
                        </div>
                     </div>
                  ))}
                  <div ref={messagesEndRef} />
               </div>

               {/* Reply Box */}
               <div className="p-4 border-t border-white/10 bg-noir">
                  <div className="relative">
                     <Textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type your reply..."
                        className="min-h-[100px] pr-32 resize-none"
                        onKeyDown={(e) => {
                           if (e.key === 'Enter' && e.metaKey) {
                              handleSendReply();
                           }
                        }}
                     />
                     <div className="absolute bottom-3 right-3 flex items-center space-x-2">
                        <button
                           type="button"
                           className="p-2 text-volt-text hover:bg-volt/10 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text"
                           title="AI Suggest"
                           aria-label="Suggest reply with AI"
                           onClick={() => setReplyText("Hi " + selectedThread.leadName.split(' ')[0] + ",\n\nThanks for getting back to me. Let's schedule a time to chat about this further.\n\nBest,\nAlex")}
                        >
                           <Sparkles className="w-5 h-5" />
                        </button>
                        <Button
                           onClick={handleSendReply}
                           disabled={isSending || !replyText.trim()}
                           loading={isSending}
                           rightIcon={!isSending ? <Send className="w-4 h-4" /> : undefined}
                           size="sm"
                        >
                           {isSending ? 'Sending...' : 'Send'}
                        </Button>
                     </div>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-2 text-center">
                     Press <span className="font-mono bg-white/[0.05] px-1 rounded">Cmd + Enter</span> to send
                  </p>
               </div>
            </>
         )}
      </div>
    </div>
  );
};
