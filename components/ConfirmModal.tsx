
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
        <div className="p-6 text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${isDanger ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400'}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex gap-3">
          <button 
            onClick={onClose} 
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={`flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-lg shadow-sm transition-all active:scale-95 ${isDanger ? 'bg-red-600 hover:bg-red-700 shadow-red-500/20' : 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/20'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
