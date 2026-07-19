import React, { useState } from 'react';

interface CampaignNameModalProps {
  onContinue: (name: string) => void;
  onCancel: () => void;
}

function defaultName(): string {
  return `Untitled Campaign ${new Date().toLocaleDateString()}`;
}

export const CampaignNameModal: React.FC<CampaignNameModalProps> = ({ onContinue, onCancel }) => {
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-white/[0.02] border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Create Campaign</h2>
        <p className="text-sm text-neutral-400 mb-4">Give your campaign a name, or skip to use a default.</p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q1 Outreach"
          className="w-full bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-neutral-500 rounded-xl px-3 py-2.5 focus:outline-none focus:border-volt-text transition-colors mb-6"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onContinue(name.trim() || defaultName());
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-neutral-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/16 rounded-full transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onContinue(defaultName())}
            className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white rounded-full transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onContinue(name.trim() || defaultName())}
            className="px-4 py-2 text-sm font-semibold text-white bg-volt hover:shadow-[0_0_20px_rgb(2_1_255/0.55)] rounded-full transition-all"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default CampaignNameModal;
