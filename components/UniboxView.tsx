import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Circle, Send, Sparkles, MoreVertical, Archive, CheckCircle2, ChevronDown, User, MessageSquare } from 'lucide-react';
import { Thread, ThreadStatus, ThreadLeadStatus } from '../types';
import { fetchInboxThreads, sendReplyToThread, updateThreadStatus, updateThreadLeadStatus } from '../services/mockZoho';
import { useNotification } from '../context/NotificationContext';

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
      await sendReplyToThread(selectedThreadId, replyText);
      // Refresh threads to get the new message
      const updatedThreads = await fetchInboxThreads();
      if (isMounted.current) {
        setThreads(updatedThreads);
        setReplyText('');
        showToast('SUCCESS', "Reply sent successfully.");
      }
    } catch (e) {
      console.error("Failed to send reply", e);
      showToast('ERROR', "Failed to send reply. Please try again.");
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

  const getStatusColor = (status: ThreadLeadStatus) => {
    switch (status) {
      case 'INTERESTED': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'NOT_INTERESTED': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'MEETING_BOOKED': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'LEFT_HANGING': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
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
    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden bg-white dark:bg-slate-950">
      
      {/* LEFT SIDEBAR: THREAD LIST */}
      <div className={`w-full md:w-80 lg:w-96 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 ${selectedThreadId ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Search & Filter Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
           <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search inbox..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              />
           </div>
           
           <div className="flex space-x-1 p-1 bg-slate-200/50 dark:bg-slate-800 rounded-lg">
              {['ALL', 'UNREAD', 'INTERESTED'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f as any)}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                    filter === f 
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
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
             <div className="p-8 text-center text-slate-400 text-sm">Loading threads...</div>
           ) : filteredThreads.length === 0 ? (
             <div className="p-8 text-center text-slate-400 text-sm">No conversations found.</div>
           ) : (
             filteredThreads.map(thread => (
               <div 
                 key={thread.id}
                 onClick={() => handleSelectThread(thread)}
                 className={`p-4 border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-white dark:hover:bg-slate-800/80 transition-colors relative group ${
                   selectedThreadId === thread.id ? 'bg-white dark:bg-slate-800 shadow-[inset_3px_0_0_0_#0ea5e9]' : ''
                 }`}
               >
                  <div className="flex justify-between items-start mb-1">
                     <h4 className={`text-sm font-semibold truncate pr-2 ${thread.status === 'UNREAD' ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                       {thread.leadName}
                     </h4>
                     <span className="text-[10px] text-slate-400 whitespace-nowrap">
                       {formatMessageDate(thread.lastMessageDate)}
                     </span>
                  </div>
                  
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mb-1">
                     {thread.leadCompany}
                  </div>

                  <p className={`text-xs truncate ${thread.status === 'UNREAD' ? 'text-slate-800 dark:text-slate-200 font-medium' : 'text-slate-500 dark:text-slate-500'}`}>
                     {thread.messages[thread.messages.length - 1].content}
                  </p>

                  {thread.status === 'UNREAD' && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-2 h-2 bg-brand-500 rounded-full shadow-glow" />
                  )}
               </div>
             ))
           )}
        </div>
      </div>

      {/* RIGHT PANEL: CONVERSATION */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-slate-950 relative ${!selectedThreadId ? 'hidden md:flex' : 'flex'}`}>
         {!selectedThread ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 p-8">
               <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600" />
               </div>
               <p className="text-lg font-medium">Select a conversation</p>
            </div>
         ) : (
            <>
               {/* Header */}
               <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-950 sticky top-0 z-10">
                  <div className="flex items-center min-w-0">
                     <button onClick={() => setSelectedThreadId(null)} className="md:hidden mr-3 text-slate-500">
                        <ChevronDown className="w-5 h-5 rotate-90" />
                     </button>
                     <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold mr-3 shrink-0">
                        {selectedThread.leadName.charAt(0)}
                     </div>
                     <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                           {selectedThread.leadName}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                           {selectedThread.leadCompany} • {selectedThread.subject}
                        </p>
                     </div>
                  </div>

                  <div className="flex items-center space-x-2">
                     <div className="relative group">
                        <button className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase flex items-center transition-all ${getStatusColor(selectedThread.leadStatus)}`}>
                           {selectedThread.leadStatus.replace('_', ' ')} <ChevronDown className="w-3 h-3 ml-1.5" />
                        </button>
                        
                        {/* Dropdown */}
                        <div className="absolute right-0 top-full mt-2 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 hidden group-hover:block z-20">
                           {['INTERESTED', 'NOT_INTERESTED', 'MEETING_BOOKED', 'LEFT_HANGING'].map(s => (
                              <button 
                                key={s} 
                                onClick={() => handleLeadStatusChange(s as ThreadLeadStatus)}
                                className="block w-full text-left px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                 {s.replace('_', ' ')}
                              </button>
                           ))}
                        </div>
                     </div>
                     <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                        <Archive className="w-4 h-4" />
                     </button>
                  </div>
               </div>

               {/* Message Stream */}
               <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 dark:bg-slate-900/50 custom-scrollbar">
                  {selectedThread.messages.map((msg, idx) => (
                     <div key={msg.id} className={`flex ${msg.sender === 'ME' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed ${
                           msg.sender === 'ME' 
                             ? 'bg-brand-600 text-white rounded-br-none' 
                             : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none'
                        }`}>
                           <p className="whitespace-pre-wrap">{msg.content}</p>
                           <p className={`text-[10px] mt-1.5 text-right opacity-70 ${msg.sender === 'ME' ? 'text-brand-100' : 'text-slate-400'}`}>
                              {new Date(msg.date).toLocaleString([], {weekday: 'short', hour: '2-digit', minute:'2-digit'})}
                           </p>
                        </div>
                     </div>
                  ))}
                  <div ref={messagesEndRef} />
               </div>

               {/* Reply Box */}
               <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                  <div className="relative">
                     <textarea 
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type your reply..."
                        className="w-full min-h-[100px] p-4 pr-32 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none text-sm text-slate-800 dark:text-slate-200"
                        onKeyDown={(e) => {
                           if (e.key === 'Enter' && e.metaKey) {
                              handleSendReply();
                           }
                        }}
                     />
                     <div className="absolute bottom-3 right-3 flex items-center space-x-2">
                        <button 
                           className="p-2 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                           title="AI Suggest"
                           onClick={() => setReplyText("Hi " + selectedThread.leadName.split(' ')[0] + ",\n\nThanks for getting back to me. Let's schedule a time to chat about this further.\n\nBest,\nAlex")}
                        >
                           <Sparkles className="w-5 h-5" />
                        </button>
                        <button 
                           onClick={handleSendReply}
                           disabled={isSending || !replyText.trim()}
                           className="flex items-center px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-md transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                           {isSending ? 'Sending...' : (
                              <>Send <Send className="w-4 h-4 ml-2" /></>
                           )}
                        </button>
                     </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 text-center">
                     Press <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">Cmd + Enter</span> to send
                  </p>
               </div>
            </>
         )}
      </div>
    </div>
  );
};