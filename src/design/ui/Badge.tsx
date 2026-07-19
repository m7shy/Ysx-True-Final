import React from 'react';

export type BadgeVariant =
  | 'neutral'
  | 'volt'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** icon rendered before the label */
  icon?: React.ReactNode;
}

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-white/[0.06] text-neutral-300 border-white/10',
  volt: 'bg-volt/15 text-volt-text border-volt-text/25',
  success: 'bg-green-500/15 text-green-400 border-green-500/25',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-400 border-red-500/25',
};

/** Pill badge with translucent semantic fills. */
export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  icon,
  className = '',
  children,
  ...rest
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VARIANTS[variant]} ${className}`}
    {...rest}
  >
    {icon}
    {children}
  </span>
);

export default Badge;
