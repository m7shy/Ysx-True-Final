import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { EASE } from '../motion';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** accessible name; wired to aria-labelledby when provided */
  title?: string;
  size?: ModalSize;
  /** clicking the backdrop closes (default true) */
  closeOnBackdrop?: boolean;
  className?: string;
  children: React.ReactNode;
}

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Fixed-overlay dialog rendered through a portal. Esc closes, focus moves to
 * the first focusable on open and restores on close, respects reduced motion.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = 'md',
  closeOnBackdrop = true,
  className = '',
  children,
}) => {
  const reduce = useReducedMotion();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  const reactId = React.useId();
  const titleId = title ? `${reactId}-title` : undefined;

  // Esc to close
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Focus first focusable on open; restore on close.
  React.useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panelRef.current)?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [isOpen]);

  const duration = reduce ? 0 : 0.7;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
            onClick={closeOnBackdrop ? onClose : undefined}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 24, filter: 'blur(14px)' }
            }
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 12, filter: 'blur(8px)' }
            }
            transition={{ duration, ease: EASE }}
            className={`relative w-full ${SIZES[size]} rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl focus:outline-none ${className}`}
          >
            {title && (
              <h2
                id={titleId}
                className="px-6 pt-6 text-lg font-semibold text-white"
              >
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default Modal;
