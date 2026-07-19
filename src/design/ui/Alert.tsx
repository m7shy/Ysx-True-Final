import React from 'react';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

const CONFIG: Record<
  AlertVariant,
  { icon: LucideIcon; wrap: string; iconColor: string }
> = {
  info: {
    icon: Info,
    wrap: 'bg-volt/10 border-volt-text/25 text-neutral-200',
    iconColor: 'text-volt-text',
  },
  success: {
    icon: CheckCircle2,
    wrap: 'bg-green-500/10 border-green-500/25 text-neutral-200',
    iconColor: 'text-green-400',
  },
  warning: {
    icon: AlertTriangle,
    wrap: 'bg-amber-500/10 border-amber-500/25 text-neutral-200',
    iconColor: 'text-amber-400',
  },
  error: {
    icon: XCircle,
    wrap: 'bg-red-500/10 border-red-500/25 text-neutral-200',
    iconColor: 'text-red-400',
  },
};

/** Inline message banner. error/warning announce via role="alert". */
export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  title,
  className = '',
  children,
  ...rest
}) => {
  const { icon: Icon, wrap, iconColor } = CONFIG[variant];
  const assertive = variant === 'error' || variant === 'warning';
  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={`flex gap-3 rounded-xl border p-4 text-sm ${wrap} ${className}`}
      {...rest}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold text-white">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
};

export default Alert;
