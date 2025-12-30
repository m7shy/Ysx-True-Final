
import React, { useState } from 'react';
import { Film, Lock, Sparkles, Loader2, Copy, Filter, Clapperboard, FileText, Layers, MessageCircle, AlertTriangle } from 'lucide-react';
import { processStoryDump } from '../services/gemini';
import { StoryIdea } from '../types';

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
      case 'Funny': return <span className="px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-[10px] font-bold uppercase border border-yellow-200 dark:border-yellow-800">🤣 Funny</span>;
      case 'Painful': return <span className="px-2 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-[10px] font-bold uppercase border border-red-200 dark:border-red-800">😭 Painful</span>;
      case 'Inspiring': return <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] font-bold uppercase border border-emerald-200 dark:border-emerald-800">🚀 Inspiring</span>;
      case 'Educational': return <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] font-bold uppercase border border-blue-200 dark:border-blue-800">🧠 Educational</span>;
      case 'Controversial': return <span className="px-2 py-1 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-[10px] font-bold uppercase border border-orange-200 dark:border-orange-800">🔥 Controversial</span>;
      default: return <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-bold uppercase">{emotion}</span>;
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
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
          <Film className="w-6 h-6 mr-2 text-brand-500" />
          Story Vault Engine
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Turn raw brain dumps into structured content gold.</p>
      </div>

      {/* INPUT AREA */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 mb-8">
         <div className="relative">
            <textarea
              value={dumpText}
              onChange={(e) => {
                setDumpText(e.target.value);
                if (error) setError(null);
              }}
              className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none text-slate-700 dark:text-slate-200 transition-shadow"
              placeholder="Paste voice note transcript, rough notes, or a random stream of consciousness here..."
            />
            <div className="absolute bottom-3 right-3">
               <button 
                 onClick={handleProcess}
                 disabled={isProcessing || !dumpText.trim()}
                 className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-lg shadow-brand-500/20 transition-all active:scale-95 flex items-center disabled:opacity-70 disabled:cursor-not-allowed"
               >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                  {isProcessing ? 'Processing...' : 'Vault It'}
               </button>
            </div>
         </div>
         
         {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start text-red-600 dark:text-red-400 text-sm animate-in slide-in-from-top-2">
              <AlertTriangle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
              {error}
            </div>
         )}
      </div>

      {/* FILTERS */}
      {(stories.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-6 animate-in slide-in-from-top-2">
           <div className="flex items-center text-sm font-bold text-slate-400 uppercase mr-2">
             <Filter className="w-4 h-4 mr-1" /> Filters:
           </div>
           <button onClick={() => setFilterEmotion(null)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${!filterEmotion ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>All Emotions</button>
           {['Funny', 'Painful', 'Inspiring', 'Educational', 'Controversial'].map(e => (
             <button key={e} onClick={() => setFilterEmotion(filterEmotion === e ? null : e)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${filterEmotion === e ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>{e}</button>
           ))}
           <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-2" />
           <button onClick={() => setFilterFormat(null)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${!filterFormat ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>All Formats</button>
           {['Reel', 'Long-form', 'Carousel'].map(f => (
             <button key={f} onClick={() => setFilterFormat(filterFormat === f ? null : f)} className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${filterFormat === f ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>{f}</button>
           ))}
        </div>
      )}

      {/* GRID */}
      {stories.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-12">
           <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-4">
             <Sparkles className="w-8 h-8 text-slate-300 dark:text-slate-600" />
           </div>
           <p className="text-lg font-medium">The Vault is empty.</p>
           <p className="text-sm">Drop an idea above to start building.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
           {filteredStories.map((story, i) => (
             <div key={story.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 group flex flex-col h-full animate-in zoom-in-95" style={{animationDelay: `${i * 50}ms`}}>
                <div className="flex justify-between items-start mb-3">
                   <div className="flex gap-2">
                      {getEmotionBadge(story.emotion)}
                   </div>
                   <div className="flex items-center text-[10px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-100 dark:border-slate-700">
                      {getFormatIcon(story.format)} {story.format}
                   </div>
                </div>
                
                <div className="mb-4">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2">"{story.hook}"</h3>
                   <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{story.coreStory}</p>
                </div>

                <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                   <button 
                     onClick={() => handleCopy(`Hook: ${story.hook}\n\nScript Idea: ${story.coreStory}`, story.id)}
                     className="text-xs font-bold text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400 flex items-center transition-colors"
                   >
                      {copiedId === story.id ? (
                        <>Copied! <Sparkles className="w-3 h-3 ml-1" /></>
                      ) : (
                        <>Copy Script <Copy className="w-3 h-3 ml-1" /></>
                      )}
                   </button>
                </div>
             </div>
           ))}
        </div>
      )}
    </div>
  );
};
