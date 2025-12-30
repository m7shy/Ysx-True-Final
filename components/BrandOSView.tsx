
import React, { useState } from 'react';
import { CheckCircle2, XCircle, Palette, Sparkles, Loader2, Wand2, Copy, ArrowLeft, AlertTriangle } from 'lucide-react';
import { generateBrandBible } from '../services/gemini';
import { BrandBible } from '../types';

export const BrandOSView: React.FC = () => {
  const [clientNotes, setClientNotes] = useState('');
  const [contentSamples, setContentSamples] = useState('');
  const [brandBible, setBrandBible] = useState<BrandBible | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!clientNotes.trim() || !contentSamples.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await generateBrandBible(clientNotes, contentSamples);
      if (result) {
        setBrandBible(result);
      } else {
        setError("Could not generate Brand Bible. The AI response was invalid or blocked. Please try again with more details.");
      }
    } catch (error) {
      console.error("Failed to generate brand bible", error);
      setError("An unexpected error occurred. Please check your network and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!brandBible) {
    return (
      <div className="p-8 h-full overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900/30 mb-4">
               <Palette className="w-8 h-8 text-brand-600 dark:text-brand-400" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">Brand OS Generator</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
               Upload your messy notes and content samples. We'll distill them into a pristine Brand Bible defining your Voice, Visuals, and Rules.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 p-6 md:p-8 space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
                Client Discovery Notes
              </label>
              <textarea
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                placeholder="Paste raw notes from your discovery call, onboarding form, or strategy session..."
                className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none text-slate-700 dark:text-slate-200 transition-shadow text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
                Content Samples
              </label>
              <textarea
                value={contentSamples}
                onChange={(e) => setContentSamples(e.target.value)}
                placeholder="Paste 3-5 examples of their best performing emails, posts, or scripts..."
                className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none text-slate-700 dark:text-slate-200 transition-shadow text-sm"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start text-red-600 dark:text-red-400 text-sm animate-in slide-in-from-top-2">
                <AlertTriangle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isLoading || !clientNotes || !contentSamples}
              className="w-full py-4 bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg shadow-brand-500/25 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center text-lg"
            >
              {isLoading ? (
                <>
                   <Loader2 className="w-6 h-6 animate-spin mr-3" />
                   Extracting Brand DNA...
                </>
              ) : (
                <>
                   <Wand2 className="w-6 h-6 mr-3" />
                   Generate Brand OS
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-y-auto custom-scrollbar animate-in fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
            <Palette className="w-6 h-6 mr-3 text-brand-500" />
            Brand Operating System
          </h2>
        </div>
        <div className="flex space-x-3">
           <button 
             onClick={() => setBrandBible(null)}
             className="flex items-center px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
           >
             <ArrowLeft className="w-4 h-4 mr-2" /> New Project
           </button>
           <button className="flex items-center px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-all">
             <Copy className="w-4 h-4 mr-2" /> Copy All
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">
        
        {/* Voice Profile */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
           <h3 className="text-xs font-bold text-brand-500 uppercase tracking-widest mb-6">Voice Profile</h3>
           
           <div className="mb-6">
             <div className="inline-block px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-bold uppercase mb-3">
               Archetype: {brandBible.voiceProfile.archetype}
             </div>
             <h4 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
               {brandBible.voiceProfile.keywords.join(' • ')}
             </h4>
             <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm">
               {brandBible.voiceProfile.description}
             </p>
           </div>

           <div className="mt-auto pt-6 border-t border-slate-100 dark:border-slate-700">
              <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">AI Prompt Starters</h4>
              <div className="space-y-2">
                {brandBible.exampleScriptPrompts.map((prompt, i) => (
                   <div key={i} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg text-xs font-mono text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                     {prompt}
                   </div>
                ))}
              </div>
           </div>
        </div>

        {/* Visual Rules */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
           <h3 className="text-xs font-bold text-purple-500 uppercase tracking-widest mb-6">Visual Identity</h3>
           
           <div className="mb-8">
             <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Color Palette</p>
             <div className="flex space-x-4">
               {brandBible.visualRules.colorPalette.map((color, i) => (
                 <div key={i} className="group relative">
                   <div 
                     className="w-12 h-12 rounded-full shadow-md border border-slate-100 dark:border-slate-700 transition-transform hover:scale-110 hover:z-10 cursor-pointer"
                     style={{ backgroundColor: color }}
                     title={color}
                   />
                   <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap font-mono z-20">
                     {color}
                   </div>
                 </div>
               ))}
             </div>
           </div>

           <div className="mb-6">
             <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Typography Direction</p>
             <p className="text-slate-800 dark:text-white font-medium">{brandBible.visualRules.typography}</p>
           </div>

           <div className="mt-auto pt-6 border-t border-slate-100 dark:border-slate-700">
             <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Aesthetic Vibe</p>
             <p className="text-slate-600 dark:text-slate-300 italic">"{brandBible.visualRules.vibeDescription}"</p>
           </div>
        </div>

        {/* Do's and Don'ts */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
           <h3 className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-6">Rules of Engagement</h3>
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div>
               <h4 className="flex items-center text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-3 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-lg w-fit">
                 <CheckCircle2 className="w-4 h-4 mr-2" /> The Do's
               </h4>
               <ul className="space-y-3">
                 {brandBible.doAndDonts.dos.map((rule, i) => (
                   <li key={i} className="flex items-start text-slate-700 dark:text-slate-300 text-sm">
                     <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full mt-1.5 mr-3 shrink-0" />
                     {rule}
                   </li>
                 ))}
               </ul>
             </div>

             <div>
               <h4 className="flex items-center text-sm font-bold text-red-600 dark:text-red-400 mb-3 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg w-fit">
                 <XCircle className="w-4 h-4 mr-2" /> The Don'ts
               </h4>
               <ul className="space-y-3">
                 {brandBible.doAndDonts.donts.map((rule, i) => (
                   <li key={i} className="flex items-start text-slate-700 dark:text-slate-300 text-sm">
                     <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-1.5 mr-3 shrink-0" />
                     {rule}
                   </li>
                 ))}
               </ul>
             </div>
           </div>
        </div>

      </div>
    </div>
  );
};
