
import React, { useState } from 'react';
import { Film, Lock, Sparkles, Copy, Filter, Clapperboard, FileText, Layers, MessageCircle } from 'lucide-react';
import { processStoryDump } from '../services/gemini';
import { StoryIdea } from '../types';
import { Card, Button, Badge, Textarea, EmptyState, Alert } from '../src/design/ui';

export const StoryVaultView: React.FC = () => {
  const [dumpText, setDumpText] = useState('');
  const [stories, setStories] = useState<StoryIdea[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterEmotion, setFilterEmotion] = useState<string | null>(null);
  const [filterFormat, setFilterFormat] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!dumpText.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      const newStories = await processStoryDump(dumpText);
      if (newStories.length > 0) {
        setStories(prev => [...newStories, ...prev]);
        setDumpText(''); // Clear input
      } else {
        setError("Could not extract any stories. Please try providing more detailed text.");
      }
    } catch (error) {
      console.error("Processing failed", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredStories = stories.filter(s => {
    if (filterEmotion && s.emotion !== filterEmotion) return false;
    if (filterFormat && s.format !== filterFormat) return false;
    return true;
  });

  const getEmotionBadge = (emotion: string) => {
    switch (emotion) {
      case 'Funny': return <Badge variant="warning">🤣 Funny</Badge>;
      case 'Painful': return <Badge variant="danger">😭 Painful</Badge>;
      case 'Inspiring': return <Badge variant="success">🚀 Inspiring</Badge>;
      case 'Educational': return <Badge variant="volt">🧠 Educational</Badge>;
      case 'Controversial': return <Badge variant="warning">🔥 Controversial</Badge>;
      default: return <Badge variant="neutral">{emotion}</Badge>;
    }
  };

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'Reel': return <Clapperboard className="w-3 h-3 mr-1" />;
      case 'Long-form': return <FileText className="w-3 h-3 mr-1" />;
      case 'Carousel': return <Layers className="w-3 h-3 mr-1" />;
      case 'Story': return <MessageCircle className="w-3 h-3 mr-1" />;
      default: return <Film className="w-3 h-3 mr-1" />;
    }
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar flex flex-col">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-white flex items-center">
          <Film className="w-6 h-6 mr-2 text-volt-text" />
          Story Vault Engine
        </h2>
        <p className="text-neutral-400 mt-1">Turn raw brain dumps into structured content gold.</p>
      </div>

      {/* INPUT AREA */}
      <Card className="mb-8">
         <div className="relative">
            <Textarea
              value={dumpText}
              onChange={(e) => {
                setDumpText(e.target.value);
                if (error) setError(null);
              }}
              className="h-32 resize-none pr-32"
              placeholder="Paste voice note transcript, rough notes, or a random stream of consciousness here..."
            />
            <div className="absolute bottom-3 right-3">
               <Button
                 onClick={handleProcess}
                 disabled={isProcessing || !dumpText.trim()}
                 loading={isProcessing}
                 leftIcon={!isProcessing ? <Lock className="w-4 h-4" /> : undefined}
               >
                  {isProcessing ? 'Processing...' : 'Vault It'}
               </Button>
            </div>
         </div>

         {error && (
            <Alert variant="error" className="mt-4">
              {error}
            </Alert>
         )}
      </Card>

      {/* FILTERS */}
      {(stories.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-6 animate-in slide-in-from-top-2">
           <div className="flex items-center text-sm font-semibold text-neutral-500 uppercase mr-2">
             <Filter className="w-4 h-4 mr-1" /> Filters:
           </div>
           <button onClick={() => setFilterEmotion(null)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${!filterEmotion ? 'bg-white text-noir' : 'bg-white/[0.06] text-neutral-400 hover:bg-white/[0.1]'}`}>All Emotions</button>
           {['Funny', 'Painful', 'Inspiring', 'Educational', 'Controversial'].map(e => (
             <button key={e} onClick={() => setFilterEmotion(filterEmotion === e ? null : e)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${filterEmotion === e ? 'bg-volt text-white' : 'bg-white/[0.06] text-neutral-400 hover:bg-white/[0.1]'}`}>{e}</button>
           ))}
           <div className="w-px h-4 bg-white/10 mx-2" />
           <button onClick={() => setFilterFormat(null)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${!filterFormat ? 'bg-white text-noir' : 'bg-white/[0.06] text-neutral-400 hover:bg-white/[0.1]'}`}>All Formats</button>
           {['Reel', 'Long-form', 'Carousel'].map(f => (
             <button key={f} onClick={() => setFilterFormat(filterFormat === f ? null : f)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${filterFormat === f ? 'bg-volt text-white' : 'bg-white/[0.06] text-neutral-400 hover:bg-white/[0.1]'}`}>{f}</button>
           ))}
        </div>
      )}

      {/* GRID */}
      {stories.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            icon={<Sparkles className="w-8 h-8" />}
            title="The Vault is empty."
            hint="Drop an idea above to start building."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
           {filteredStories.map((story, i) => (
             <Card key={story.id} hover className="group flex flex-col h-full animate-in zoom-in-95" style={{animationDelay: `${i * 50}ms`}}>
                <div className="flex justify-between items-start mb-3">
                   <div className="flex gap-2">
                      {getEmotionBadge(story.emotion)}
                   </div>
                   <Badge variant="neutral" icon={getFormatIcon(story.format)}>
                      {story.format}
                   </Badge>
                </div>

                <div className="mb-4">
                   <h3 className="text-lg font-semibold text-white leading-tight mb-2">"{story.hook}"</h3>
                   <p className="text-sm text-neutral-400 leading-relaxed">{story.coreStory}</p>
                </div>

                <div className="mt-auto pt-4 border-t border-white/10 flex justify-end">
                   <button
                     onClick={() => handleCopy(`Hook: ${story.hook}\n\nScript Idea: ${story.coreStory}`, story.id)}
                     className="text-xs font-semibold text-neutral-400 hover:text-volt-text flex items-center transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
                   >
                      {copiedId === story.id ? (
                        <>Copied! <Sparkles className="w-3 h-3 ml-1" /></>
                      ) : (
                        <>Copy Script <Copy className="w-3 h-3 ml-1" /></>
                      )}
                   </button>
                </div>
             </Card>
           ))}
        </div>
      )}
    </div>
  );
};
