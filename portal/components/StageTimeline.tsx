import React from 'react';
import { Check } from 'lucide-react';
import type { ProjectStage } from '../services/portalApi';

const STAGES: { key: ProjectStage; label: string }[] = [
  { key: 'ONBOARDING', label: 'Onboarding' },
  { key: 'EDITING', label: 'Editing' },
  { key: 'REVISION', label: 'Revision' },
  { key: 'FINAL_DELIVERY', label: 'Final Delivery' },
  { key: 'COMPLETE', label: 'Complete' },
];

export const stageLabel = (stage: ProjectStage): string =>
  STAGES.find((s) => s.key === stage)?.label ?? stage;

/** Horizontal five-step pipeline with the current stage glowing volt. */
export const StageTimeline: React.FC<{ stage: ProjectStage }> = ({ stage }) => {
  const activeIdx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="flex items-center w-full" role="list" aria-label="Project stages">
      {STAGES.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <div
                aria-hidden
                className={`h-px flex-1 mx-1 sm:mx-2 ${done || active ? 'bg-volt-text/60' : 'bg-white/10'}`}
              />
            )}
            <div role="listitem" aria-current={active ? 'step' : undefined} className="flex flex-col items-center gap-2 min-w-0">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all duration-300 ${
                  done
                    ? 'border-volt-text/40 bg-volt/20 text-volt-text'
                    : active
                      ? 'border-volt-text bg-volt text-white shadow-[0_0_16px_rgb(2_1_255/0.55)]'
                      : 'border-white/10 bg-white/[0.03] text-neutral-500'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={`text-[10px] sm:text-xs whitespace-nowrap ${
                  active ? 'text-white font-medium' : done ? 'text-neutral-300' : 'text-neutral-500'
                }`}
              >
                {s.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
