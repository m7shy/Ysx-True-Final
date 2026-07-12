
import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen, onClose, onConfirm, title, message,
  confirmText = "Confirm", cancelText = "Cancel", isDanger = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="bg-canvas/95 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-white/10">
        <div className="p-6 text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${isDanger ? 'bg-red-500/15 text-red-400' : 'bg-brand-900/30 text-brand-400'}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 bg-white/5 border-t border-white/10 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 rounded-lg transition-colors duration-300"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={`flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-lg shadow-sm transition-all duration-300 active:scale-95 ${isDanger ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20' : 'bg-brand-600 hover:bg-brand-500 shadow-brand-500/20'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
