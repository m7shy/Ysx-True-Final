import React from 'react';
import { Loader2 } from 'lucide-react';

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  /** pixel size of the spinner (default 16) */
  size?: number;
  label?: string;
}

/** Minimal volt-tinted loading spinner. */
export const Spinner: React.FC<SpinnerProps> = ({
  size = 16,
  label = 'Loading',
  className = '',
  ...rest
}) => (
  <Loader2
    role="status"
    aria-label={label}
    width={size}
    height={size}
    className={`animate-spin ${className}`}
    {...rest}
  />
);

export default Spinner;
