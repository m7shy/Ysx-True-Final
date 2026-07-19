
import React, { useState } from 'react';
import { Copy, Plus, FileText, Check } from 'lucide-react';
import { Card, Button, Badge } from '../src/design/ui';

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
          <h2 className="text-2xl font-semibold text-white flex items-center">
            <FileText className="w-6 h-6 mr-2 text-volt-text" />
            Email Templates
          </h2>
          <p className="text-neutral-400 mt-1">Pre-approved templates for your campaigns.</p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />}>New Template</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
        {TEMPLATES.map((t, i) => (
          <Card key={i} hover className="group flex flex-col h-64">
            <div className="flex justify-between items-start mb-3">
               <h3 className="font-semibold text-white group-hover:text-volt-text transition-colors">{t.title}</h3>
               <Badge className="font-mono">TXT</Badge>
            </div>
            <div className="flex-1 text-sm text-neutral-400 bg-white/[0.03] p-3 rounded-xl border border-white/10 font-mono overflow-hidden relative">
              {t.body}
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0a0a0a] to-transparent" />
            </div>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => handleCopy(t.body, i)}
              aria-label={copiedIndex === i ? `Copied ${t.title}` : `Copy ${t.title} to clipboard`}
              leftIcon={copiedIndex === i ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              className={`mt-4 ${copiedIndex === i ? 'border-green-500/40 text-green-400' : ''}`}
            >
              {copiedIndex === i ? 'Copied!' : 'Copy to Clipboard'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
