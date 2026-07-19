import React from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** show a spinner and disable interaction */
  loading?: boolean;
  /** icon rendered before the label */
  leftIcon?: React.ReactNode;
  /** icon rendered after the label */
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium ' +
  'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-noir ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-volt text-white hover:shadow-[0_0_20px_rgb(2_1_255/0.55)]',
  secondary:
    'bg-white/[0.03] text-white border border-white/10 hover:bg-white/[0.06] hover:border-white/16',
  ghost:
    'bg-transparent text-neutral-300 hover:bg-white/[0.05] hover:text-white',
  danger:
    'bg-red-600 text-white hover:bg-red-500 hover:shadow-[0_0_20px_rgb(220_38_38/0.45)]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
};

/** Pill-shaped real <button>. Forwards all native button props + ref. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = '',
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'sm' ? 14 : 16} />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);

Button.displayName = 'Button';

export default Button;
