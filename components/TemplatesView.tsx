
import React, { useState } from 'react';
import { Copy, Plus, FileText, Check } from 'lucide-react';

const TEMPLATES = [
  { title: "Cold Outreach - Value Prop", body: "Hi {Name},\n\nI noticed that {Company} is doing great work in [Industry]. I wanted to reach out because we help similar companies scale their..." },
  { title: "Follow-up 1 - Gentle Nudge", body: "Hi {Name},\n\nJust floating this to the top of your inbox. Did you get a chance to review my previous email regarding..." },
  { title: "Follow-up 2 - Case Study Share", body: "Hi {Name},\n\nI thought you might find this relevant. Here is how we helped a similar client achieve [Result] in just 3 months..." },
  { title: "Breakup Email", body: "Hi {Name},\n\nI assume this isn't a priority right now, so I'll stop reaching out. If you ever need help with [Service], feel free to reconnect." },
  { title: "Meeting Request", body: "Hi {Name},\n\nAre you free for a quick 15-min chat next Tuesday or Wednesday? I'd love to show you how we can..." },
  { title: "Post-Event Follow-up", body: "Hi {Name},\n\nIt was great meeting you at [Event]. As discussed, here is the information about..." },
];

export const TemplatesView: React.FC = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
            <FileText className="w-6 h-6 mr-2 text-brand-500" />
            Email Templates
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Pre-approved templates for your campaigns.</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-lg shadow-brand-500/20 active:scale-95">
          <Plus className="w-4 h-4 mr-2" /> New Template
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
        {TEMPLATES.map((t, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 hover:shadow-xl transition-all cursor-pointer group hover:-translate-y-1 duration-300 flex flex-col h-64">
            <div className="flex justify-between items-start mb-3">
               <h3 className="font-semibold text-slate-800 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{t.title}</h3>
               <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded">TXT</span>
            </div>
            <div className="flex-1 text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded border border-slate-100 dark:border-slate-800/50 font-mono overflow-hidden relative">
              {t.body}
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-50 dark:from-[#1e293b] to-transparent" />
            </div>
            <button 
              onClick={() => handleCopy(t.body, i)}
              className={`mt-4 w-full py-2 text-sm border rounded-lg font-medium flex items-center justify-center transition-all ${
                 copiedIndex === i 
                   ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'
                   : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 hover:border-brand-200 dark:hover:border-brand-800 hover:text-brand-600 dark:hover:text-brand-400'
              }`}
            >
              {copiedIndex === i ? (
                <>
                  <Check className="w-4 h-4 mr-2" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" /> Copy to Clipboard
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
