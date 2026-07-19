import React from 'react';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  /** optional CTA (e.g. a <Button />) */
  action?: React.ReactNode;
}

/** Centered placeholder for empty lists / zero-data states. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  hint,
  action,
  className = '',
  ...rest
}) => (
  <div
    className={`flex flex-col items-center justify-center text-center gap-3 py-16 px-6 ${className}`}
    {...rest}
  >
    {icon && (
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl border border-white/10 bg-white/[0.02] text-volt-text">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-white">{title}</h3>
    {hint && <p className="text-sm text-neutral-400 max-w-sm">{hint}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export default EmptyState;
