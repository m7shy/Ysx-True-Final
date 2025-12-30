import React from 'react';
import { Email, EmailStatus } from '../types';
import { Mail, Reply, AlertCircle, CheckCircle2, Clock, CalendarClock, History } from 'lucide-react';

interface EmailCardProps {
  email: Email;
  isSelected: boolean;
  onClick: () => void;
}

const EmailCard: React.FC<EmailCardProps> = ({ email, isSelected, onClick }) => {
  
  const getStatusBadge = (status: EmailStatus) => {
    switch (status) {
      case EmailStatus.NO_REPLY:
        return <span className="flex items-center text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-1 rounded-full border border-amber-100 dark:border-amber-900 shadow-sm"><AlertCircle className="w-3 h-3 mr-1" /> No Reply</span>;
      case EmailStatus.REPLIED:
        return <span className="flex items-center text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/50 px-2 py-1 rounded-full border border-green-100 dark:border-green-900 shadow-sm"><Reply className="w-3 h-3 mr-1" /> Replied</span>;
      case EmailStatus.FOLLOW_UP_DRAFTED:
        return <span className="flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-1 rounded-full border border-blue-100 dark:border-blue-900 shadow-sm"><Clock className="w-3 h-3 mr-1" /> Drafted</span>;
      case EmailStatus.SCHEDULED:
        return <span className="flex items-center text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 px-2 py-1 rounded-full border border-purple-100 dark:border-purple-900 shadow-sm"><CalendarClock className="w-3 h-3 mr-1" /> Scheduled</span>;
      case EmailStatus.SENT:
      default:
        return <span className="flex items-center text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> Sent</span>;
    }
  };

  const daysAgo = Math.floor((Date.now() - new Date(email.sentDate).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div 
      onClick={onClick}
      className={`group p-4 border-b dark:border-slate-800/50 cursor-pointer transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
        isSelected 
          ? 'bg-blue-50/60 dark:bg-slate-800/80 border-l-4 border-l-brand-600 shadow-inner backdrop-blur-sm' 
          : 'bg-white dark:bg-slate-900/40 border-l-4 border-l-transparent hover:bg-white dark:hover:bg-slate-800/60 hover:shadow-md dark:hover:shadow-glow hover:border-l-slate-300 dark:hover:border-l-brand-500/50 hover:scale-[1.005] active:scale-[0.995]'
      }`}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className={`font-semibold text-sm truncate pr-2 transition-colors ${isSelected ? 'text-brand-900 dark:text-brand-200' : 'text-slate-800 dark:text-slate-200 group-hover:text-brand-700 dark:group-hover:text-brand-400'}`}>
          {email.recipientName}
        </h3>
        <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
          {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
        </span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 truncate">
        {email.company}
      </div>
      <div className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate mb-2 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
        {email.subject}
      </div>
      <div className="flex items-center justify-between mt-3">
        {getStatusBadge(email.status)}
        {email.scheduledDate ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
             {new Date(email.scheduledDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
          </span>
        ) : (
          <Mail className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition-colors" />
        )}
      </div>

      {email.followupHistory && email.followupHistory.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/50 animate-in fade-in duration-300">
          <div className="flex items-center gap-1.5 mb-2.5">
            <History className="w-3 h-3 text-slate-400 dark:text-slate-500" />
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">Activity History</p>
          </div>
          <div className="space-y-2 pl-1">
            {email.followupHistory.map((item, idx) => (
              <div key={idx} className="flex gap-2.5 text-xs group/item relative">
                {/* Timeline connector line */}
                {idx !== (email.followupHistory?.length || 0) - 1 && (
                   <div className="absolute left-[3px] top-2 bottom-[-8px] w-px bg-slate-200 dark:bg-slate-800 group-hover/item:bg-slate-300 transition-colors" />
                )}
                
                <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all ring-2 ring-white dark:ring-slate-900 ${item.status === 'SENT' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]' : 'bg-purple-500 shadow-[0_0_4px_rgba(168,85,247,0.4)]'}`} />
                
                <div className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 rounded px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-medium text-[10px] uppercase tracking-wide ${item.status === 'SENT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-purple-600 dark:text-purple-400'}`}>
                      {item.status === 'SENT' ? 'Follow-up Sent' : 'Scheduled'}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500 text-[10px] tabular-nums">
                      {new Date(item.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 truncate font-normal text-[11px] leading-relaxed opacity-90">{item.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailCard;