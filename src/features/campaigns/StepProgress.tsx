import React from 'react';
import { Check } from 'lucide-react';

export interface WizardStep {
  id: number;
  label: string;
}

interface StepProgressProps {
  steps: WizardStep[];
  current: number; // 1-based
  completed: Set<number>;
  onSelect?: (step: number) => void;
}

export const StepProgress: React.FC<StepProgressProps> = ({
  steps,
  current,
  completed,
  onSelect,
}) => {
  return (
    <ol className="flex items-center gap-2 md:gap-4 w-full">
      {steps.map((step, idx) => {
        const isDone = completed.has(step.id);
        const isActive = current === step.id;
        const isReachable = isDone || isActive || step.id <= current;
        return (
          <li key={step.id} className="flex items-center flex-1 min-w-0">
            <button
              type="button"
              onClick={() => isReachable && onSelect?.(step.id)}
              disabled={!isReachable}
              className={`flex items-center gap-2 md:gap-3 min-w-0 ${
                isReachable ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
            >
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-colors border ${
                  isDone
                    ? 'bg-volt border-volt-text/40 text-white'
                    : isActive
                    ? 'bg-white/[0.03] border-volt-text/40 text-volt-text'
                    : 'bg-white/[0.02] border-white/10 text-neutral-500'
                }`}
              >
                {isDone ? <Check className="w-4 h-4" /> : step.id}
              </span>
              <span
                className={`text-sm font-medium truncate ${
                  isActive
                    ? 'text-white'
                    : isDone
                    ? 'text-neutral-300'
                    : 'text-neutral-500'
                }`}
              >
                {step.label}
              </span>
            </button>
            {idx < steps.length - 1 && (
              <span
                className={`flex-1 h-px mx-2 md:mx-4 ${
                  completed.has(step.id) ? 'bg-volt-text/50' : 'bg-white/10'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
};
