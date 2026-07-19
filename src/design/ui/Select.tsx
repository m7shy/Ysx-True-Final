import React from 'react';
import { ChevronDown } from 'lucide-react';

const FIELD =
  'w-full appearance-none rounded-xl bg-white/[0.03] border border-white/10 text-white ' +
  'px-3.5 py-2.5 pr-10 text-sm transition-colors duration-300 ' +
  'focus:outline-none focus:border-volt-text focus-visible:border-volt-text ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const ERROR_FIELD = 'border-red-500/60 focus:border-red-500';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/** Dark native <select> with chevron affordance, label + error wiring. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, id, className = '', children, ...rest }, ref) => {
    const reactId = React.useId();
    const fieldId = id ?? reactId;
    const errorId = `${fieldId}-error`;
    const hintId = `${fieldId}-hint`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={fieldId} className="text-sm font-medium text-neutral-300">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            className={`${FIELD} ${error ? ERROR_FIELD : ''} ${className}`}
            {...rest}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
          />
        </div>
        {error ? (
          <p id={errorId} className="text-xs text-red-400">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-neutral-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
