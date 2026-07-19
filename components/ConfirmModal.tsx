import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from '../src/design/ui';

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
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="p-6 text-center">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${
            isDanger ? 'bg-red-500/15 text-red-400' : 'bg-volt/15 text-volt-text'
          }`}
        >
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-neutral-400 leading-relaxed">{message}</p>
      </div>
      <div className="px-6 py-4 bg-white/[0.03] border-t border-white/10 flex gap-3">
        <Button variant="ghost" fullWidth onClick={onClose}>
          {cancelText}
        </Button>
        <Button
          variant={isDanger ? 'danger' : 'primary'}
          fullWidth
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
};
