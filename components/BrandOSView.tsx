
import React, { useState } from 'react';
import { CheckCircle2, XCircle, Palette, Wand2, Copy, ArrowLeft } from 'lucide-react';
import { generateBrandBible } from '../services/gemini';
import { BrandBible } from '../types';
import { Card, Button, Textarea, Alert, Eyebrow } from '../src/design/ui';

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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-volt/15 mb-4">
               <Palette className="w-8 h-8 text-volt-text" />
            </div>
            <h2 className="text-3xl font-semibold text-white mb-3">Brand OS Generator</h2>
            <p className="text-lg text-neutral-400 leading-relaxed">
               Upload your messy notes and content samples. We'll distill them into a pristine Brand Bible defining your Voice, Visuals, and Rules.
            </p>
          </div>

          <Card padding="lg" className="space-y-6">
            <Textarea
              label="Client Discovery Notes"
              value={clientNotes}
              onChange={(e) => setClientNotes(e.target.value)}
              placeholder="Paste raw notes from your discovery call, onboarding form, or strategy session..."
              className="h-32 resize-none"
            />

            <Textarea
              label="Content Samples"
              value={contentSamples}
              onChange={(e) => setContentSamples(e.target.value)}
              placeholder="Paste 3-5 examples of their best performing emails, posts, or scripts..."
              className="h-32 resize-none"
            />

            {error && (
              <Alert variant="error">
                {error}
              </Alert>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isLoading || !clientNotes || !contentSamples}
              loading={isLoading}
              leftIcon={!isLoading ? <Wand2 className="w-5 h-5" /> : undefined}
              fullWidth
              className="py-4 text-base"
            >
              {isLoading ? 'Extracting Brand DNA...' : 'Generate Brand OS'}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-y-auto custom-scrollbar animate-in fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-white flex items-center">
            <Palette className="w-6 h-6 mr-3 text-volt-text" />
            Brand Operating System
          </h2>
        </div>
        <div className="flex space-x-3">
           <Button
             variant="ghost"
             onClick={() => setBrandBible(null)}
             leftIcon={<ArrowLeft className="w-4 h-4" />}
           >
             New Project
           </Button>
           <Button
             variant="secondary"
             leftIcon={<Copy className="w-4 h-4" />}
           >
             Copy All
           </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">

        {/* Voice Profile */}
        <Card padding="lg" className="flex flex-col">
           <Eyebrow className="mb-6">Voice Profile</Eyebrow>

           <div className="mb-6">
             <div className="inline-block px-3 py-1 rounded-full bg-white text-noir text-xs font-bold uppercase mb-3">
               Archetype: {brandBible.voiceProfile.archetype}
             </div>
             <h4 className="text-2xl font-semibold text-white mb-4">
               {brandBible.voiceProfile.keywords.join(' • ')}
             </h4>
             <p className="text-neutral-300 leading-relaxed text-sm">
               {brandBible.voiceProfile.description}
             </p>
           </div>

           <div className="mt-auto pt-6 border-t border-white/10">
              <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-3">AI Prompt Starters</h4>
              <div className="space-y-2">
                {brandBible.exampleScriptPrompts.map((prompt, i) => (
                   <div key={i} className="bg-white/[0.03] p-3 rounded-lg text-xs font-mono text-neutral-400 border border-white/10">
                     {prompt}
                   </div>
                ))}
              </div>
           </div>
        </Card>

        {/* Visual Rules */}
        <Card padding="lg" className="flex flex-col">
           <Eyebrow className="mb-6">Visual Identity</Eyebrow>

           <div className="mb-8">
             <p className="text-sm font-medium text-neutral-400 mb-3">Color Palette</p>
             <div className="flex space-x-4">
               {brandBible.visualRules.colorPalette.map((color, i) => (
                 <div key={i} className="group relative">
                   <div
                     className="w-12 h-12 rounded-full border border-white/10 transition-transform hover:scale-110 hover:z-10 cursor-pointer"
                     style={{ backgroundColor: color }}
                     title={color}
                   />
                   <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-[#0a0a0a] border border-white/10 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap font-mono z-20">
                     {color}
                   </div>
                 </div>
               ))}
             </div>
           </div>

           <div className="mb-6">
             <p className="text-sm font-medium text-neutral-400 mb-2">Typography Direction</p>
             <p className="text-white font-medium">{brandBible.visualRules.typography}</p>
           </div>

           <div className="mt-auto pt-6 border-t border-white/10">
             <p className="text-sm font-medium text-neutral-400 mb-2">Aesthetic Vibe</p>
             <p className="text-neutral-300 italic">"{brandBible.visualRules.vibeDescription}"</p>
           </div>
        </Card>

        {/* Do's and Don'ts */}
        <Card padding="lg" className="lg:col-span-2">
           <Eyebrow className="mb-6">Rules of Engagement</Eyebrow>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div>
               <h4 className="flex items-center text-sm font-semibold text-green-400 mb-3 bg-green-500/10 px-3 py-1.5 rounded-lg w-fit">
                 <CheckCircle2 className="w-4 h-4 mr-2" /> The Do's
               </h4>
               <ul className="space-y-3">
                 {brandBible.doAndDonts.dos.map((rule, i) => (
                   <li key={i} className="flex items-start text-neutral-300 text-sm">
                     <div className="w-1.5 h-1.5 bg-green-400 rounded-full mt-1.5 mr-3 shrink-0" />
                     {rule}
                   </li>
                 ))}
               </ul>
             </div>

             <div>
               <h4 className="flex items-center text-sm font-semibold text-red-400 mb-3 bg-red-500/10 px-3 py-1.5 rounded-lg w-fit">
                 <XCircle className="w-4 h-4 mr-2" /> The Don'ts
               </h4>
               <ul className="space-y-3">
                 {brandBible.doAndDonts.donts.map((rule, i) => (
                   <li key={i} className="flex items-start text-neutral-300 text-sm">
                     <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-1.5 mr-3 shrink-0" />
                     {rule}
                   </li>
                 ))}
               </ul>
             </div>
           </div>
        </Card>

      </div>
    </div>
  );
};
