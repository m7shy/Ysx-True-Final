/* ============================================================================
   SaaS Noir — UI primitives barrel (Phase 2)
   Self-contained: imports only from src/design/motion.ts, motion/react,
   lucide-react, react, react-dom. No app-code imports.
   ============================================================================ */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Card } from './Card';
export type { CardProps, CardPadding } from './Card';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

export { Table, THead, TBody, TR, TH, TD } from './Table';
export type { TRProps } from './Table';

export { Badge } from './Badge';
export type { BadgeProps, BadgeVariant } from './Badge';

export { Alert } from './Alert';
export type { AlertProps, AlertVariant } from './Alert';

export { Eyebrow } from './Eyebrow';
export type { EyebrowProps } from './Eyebrow';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
