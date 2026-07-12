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
        return <span className="flex items-center text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-400/20"><AlertCircle className="w-3 h-3 mr-1" /> No Reply</span>;
      case EmailStatus.REPLIED:
        return <span className="flex items-center text-xs font-medium text-green-400 bg-green-500/10 px-2 py-1 rounded-full border border-green-400/20"><Reply className="w-3 h-3 mr-1" /> Replied</span>;
      case EmailStatus.FOLLOW_UP_DRAFTED:
        return <span className="flex items-center text-xs font-medium text-blue-400 bg-blue-500/10 px-2 py-1 rounded-full border border-blue-400/20"><Clock className="w-3 h-3 mr-1" /> Drafted</span>;
      case EmailStatus.SCHEDULED:
        return <span className="flex items-center text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full border border-purple-400/20"><CalendarClock className="w-3 h-3 mr-1" /> Scheduled</span>;
      case EmailStatus.SENT:
      default:
        return <span className="flex items-center text-xs font-medium text-slate-400 bg-white/5 px-2 py-1 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> Sent</span>;
    }
  };

  const daysAgo = Math.floor((Date.now() - new Date(email.sentDate).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div
      onClick={onClick}
      className={`group p-4 border-b border-white/5 cursor-pointer transition-all duration-300 ${
        isSelected
          ? 'bg-white/10 border-l-4 border-l-brand-500 backdrop-blur-sm'
          : 'bg-transparent border-l-4 border-l-transparent hover:bg-white/5 hover:shadow-glow hover:border-l-brand-500/50 hover:scale-[1.005] active:scale-[0.995]'
      }`}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className={`font-semibold text-sm truncate pr-2 transition-colors duration-300 ${isSelected ? 'text-brand-200' : 'text-slate-200 group-hover:text-brand-400'}`}>
          {email.recipientName}
        </h3>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
        </span>
      </div>
      <div className="text-xs text-slate-400 mb-2 truncate">
        {email.company}
      </div>
      <div className="text-sm text-slate-300 font-medium truncate mb-2 group-hover:text-white transition-colors duration-300">
        {email.subject}
      </div>
      <div className="flex items-center justify-between mt-3">
        {getStatusBadge(email.status)}
        {email.scheduledDate ? (
          <span className="text-xs text-slate-500 flex items-center bg-white/5 px-1.5 py-0.5 rounded">
             {new Date(email.scheduledDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
          </span>
        ) : (
          <Mail className="w-4 h-4 text-slate-600 group-hover:text-slate-500 transition-colors duration-300" />
        )}
      </div>

      {email.followupHistory && email.followupHistory.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <History className="w-3 h-3 text-slate-500" />
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Activity History</p>
          </div>
          <div className="space-y-2 pl-1">
            {email.followupHistory.map((item, idx) => (
              <div key={idx} className="flex gap-2.5 text-xs group/item relative">
                {/* Timeline connector line */}
                {idx !== (email.followupHistory?.length || 0) - 1 && (
                   <div className="absolute left-[3px] top-2 bottom-[-8px] w-px bg-white/10 group-hover/item:bg-white/20 transition-colors duration-300" />
                )}

                <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all ring-2 ring-slate-900 ${item.status === 'SENT' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]' : 'bg-purple-500 shadow-[0_0_4px_rgba(168,85,247,0.4)]'}`} />

                <div className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 hover:bg-white/10 transition-colors duration-300">
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-medium text-[10px] uppercase tracking-wide ${item.status === 'SENT' ? 'text-emerald-400' : 'text-purple-400'}`}>
                      {item.status === 'SENT' ? 'Follow-up Sent' : 'Scheduled'}
                    </span>
                    <span className="text-slate-500 text-[10px] tabular-nums">
                      {new Date(item.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                    </span>
                  </div>
                  <p className="text-slate-300 truncate font-normal text-[11px] leading-relaxed opacity-90">{item.content}</p>
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
