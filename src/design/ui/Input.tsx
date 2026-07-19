import React from 'react';

const FIELD =
  'w-full rounded-xl bg-white/[0.03] border border-white/10 text-white ' +
  'placeholder:text-neutral-500 px-3.5 py-2.5 text-sm transition-colors duration-300 ' +
  'focus:outline-none focus:border-volt-text focus-visible:border-volt-text ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const ERROR_FIELD = 'border-red-500/60 focus:border-red-500';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/** Dark text field with label + error wiring for a11y. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className = '', ...rest }, ref) => {
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
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={`${FIELD} ${error ? ERROR_FIELD : ''} ${className}`}
          {...rest}
        />
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

Input.displayName = 'Input';

export default Input;
