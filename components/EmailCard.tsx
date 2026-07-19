import React from 'react';
import { Email, EmailStatus } from '../types';
import { Mail, Reply, AlertCircle, CheckCircle2, Clock, CalendarClock, History } from 'lucide-react';
import { Badge } from '../src/design/ui';

interface EmailCardProps {
  email: Email;
  isSelected: boolean;
  onClick: () => void;
}

const EmailCard: React.FC<EmailCardProps> = ({ email, isSelected, onClick }) => {

  const getStatusBadge = (status: EmailStatus) => {
    switch (status) {
      case EmailStatus.NO_REPLY:
        return <Badge variant="warning" icon={<AlertCircle className="w-3 h-3" />}>No Reply</Badge>;
      case EmailStatus.REPLIED:
        return <Badge variant="success" icon={<Reply className="w-3 h-3" />}>Replied</Badge>;
      case EmailStatus.FOLLOW_UP_DRAFTED:
        return <Badge variant="volt" icon={<Clock className="w-3 h-3" />}>Drafted</Badge>;
      case EmailStatus.SCHEDULED:
        return <Badge variant="neutral" icon={<CalendarClock className="w-3 h-3" />}>Scheduled</Badge>;
      case EmailStatus.SENT:
      default:
        return <Badge variant="neutral" icon={<CheckCircle2 className="w-3 h-3" />}>Sent</Badge>;
    }
  };

  const daysAgo = Math.floor((Date.now() - new Date(email.date).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`group w-full text-left p-4 border-b border-white/5 cursor-pointer transition-all duration-300 ${
        isSelected
          ? 'bg-white/10 border-l-4 border-l-volt backdrop-blur-sm'
          : 'bg-transparent border-l-4 border-l-transparent hover:bg-white/5 hover:shadow-[0_0_20px_rgb(2_1_255/0.35)] hover:border-l-volt/50 hover:scale-[1.005] active:scale-[0.995]'
      }`}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className={`font-semibold text-sm truncate pr-2 transition-colors duration-300 ${isSelected ? 'text-volt-text' : 'text-neutral-200 group-hover:text-volt-text'}`}>
          {email.recipientName}
        </h3>
        <span className="text-xs text-neutral-500 whitespace-nowrap">
          {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
        </span>
      </div>
      <div className="text-xs text-neutral-400 mb-2 truncate">
        {email.company}
      </div>
      <div className="text-sm text-neutral-300 font-medium truncate mb-2 group-hover:text-white transition-colors duration-300">
        {email.subject}
      </div>
      <div className="flex items-center justify-between mt-3">
        {getStatusBadge(email.status)}
        {email.scheduledDate ? (
          <span className="text-xs text-neutral-500 flex items-center bg-white/5 px-1.5 py-0.5 rounded">
             {new Date(email.scheduledDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
          </span>
        ) : (
          <Mail className="w-4 h-4 text-neutral-600 group-hover:text-neutral-500 transition-colors duration-300" />
        )}
      </div>

      {email.followUpHistory && email.followUpHistory.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <History className="w-3 h-3 text-neutral-500" />
            <p className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">Activity History</p>
          </div>
          <div className="space-y-2 pl-1">
            {email.followUpHistory.map((item, idx) => (
              <div key={idx} className="flex gap-2.5 text-xs group/item relative">
                {/* Timeline connector line */}
                {idx !== (email.followUpHistory?.length || 0) - 1 && (
                   <div className="absolute left-[3px] top-2 bottom-[-8px] w-px bg-white/10 group-hover/item:bg-white/20 transition-colors duration-300" />
                )}

                <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 transition-all ring-2 ring-[#0a0a0a] ${item.status === 'SENT' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]' : 'bg-purple-500 shadow-[0_0_4px_rgba(168,85,247,0.4)]'}`} />

                <div className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 hover:bg-white/10 transition-colors duration-300">
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-medium text-[10px] uppercase tracking-wide ${item.status === 'SENT' ? 'text-emerald-400' : 'text-purple-400'}`}>
                      {item.status === 'SENT' ? 'Follow-up Sent' : 'Scheduled'}
                    </span>
                    <span className="text-neutral-500 text-[10px] tabular-nums">
                      {new Date(item.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                    </span>
                  </div>
                  <p className="text-neutral-300 truncate font-normal text-[11px] leading-relaxed opacity-90">{item.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </button>
  );
};

export default EmailCard;
