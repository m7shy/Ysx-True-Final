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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Create Campaign</h2>
        <p className="text-sm text-slate-400 mb-4">Give your campaign a name, or skip to use a default.</p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q1 Outreach"
          className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-6"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onContinue(name.trim() || defaultName());
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onContinue(defaultName())}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-lg"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onContinue(name.trim() || defaultName())}
            className="px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 rounded-lg"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default CampaignNameModal;
