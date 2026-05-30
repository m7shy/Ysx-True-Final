import React, { useState } from 'react';
import { Plus, Mail, Clock, CornerDownRight, Trash2 } from 'lucide-react';
import { SequenceStage, SequenceVariant } from '../types';
import { VariableHighlightEditor } from '../components/VariableHighlightEditor';

interface Step2Props {
  sequence: SequenceStage[];
  onChange: (sequence: SequenceStage[]) => void;
}

export const Step2Sequences: React.FC<Step2Props> = ({ sequence, onChange }) => {
  const [activeStageId, setActiveStageId] = useState(sequence[0]?.id ?? '');
  const [activeVariantId, setActiveVariantId] = useState(
    sequence[0]?.variants[0]?.id ?? ''
  );

  const activeStage =
    sequence.find((s) => s.id === activeStageId) ?? sequence[0];
  const activeVariant =
    activeStage?.variants.find((v) => v.id === activeVariantId) ??
    activeStage?.variants[0];

  const updateVariant = (patch: Partial<SequenceVariant>) => {
    if (!activeStage || !activeVariant) return;
    onChange(
      sequence.map((s) =>
        s.id !== activeStage.id
          ? s
          : {
              ...s,
              variants: s.variants.map((v) =>
                v.id === activeVariant.id ? { ...v, ...patch } : v
              ),
            }
      )
    );
  };

  const addVariant = (stageId: string) => {
    const newId = `${stageId}-v${Date.now()}`;
    onChange(
      sequence.map((s) => {
        if (s.id !== stageId) return s;
        const base = s.variants[0];
        return {
          ...s,
          variants: [
            ...s.variants,
            {
              id: newId,
              subject: base?.subject ?? '',
              body: base?.body ?? '',
            },
          ],
        };
      })
    );
    setActiveStageId(stageId);
    setActiveVariantId(newId);
  };

  const removeVariant = (stageId: string, variantId: string) => {
    const stage = sequence.find((s) => s.id === stageId);
    if (!stage || stage.variants.length <= 1) return;
    onChange(
      sequence.map((s) =>
        s.id !== stageId
          ? s
          : { ...s, variants: s.variants.filter((v) => v.id !== variantId) }
      )
    );
    const remaining = stage.variants.filter((v) => v.id !== variantId);
    setActiveVariantId(remaining[0]?.id ?? '');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 max-w-6xl mx-auto">
      {/* Left sidebar: stages + variants */}
      <aside className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
          Sequence
        </h3>
        <ol className="space-y-3">
          {sequence.map((stage, idx) => {
            const isActive = stage.id === activeStage?.id;
            return (
              <li key={stage.id}>
                {idx > 0 && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-2 pl-2">
                    <Clock className="w-3 h-3" />
                    {stage.waitDays} day{stage.waitDays === 1 ? '' : 's'} wait
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveStageId(stage.id);
                    setActiveVariantId(stage.variants[0].id);
                  }}
                  className={`w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                    isActive
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {stage.isThreadReply ? (
                      <CornerDownRight className="w-4 h-4 text-slate-400" />
                    ) : (
                      <Mail className="w-4 h-4 text-brand-400" />
                    )}
                    <span className="text-sm font-semibold text-white">
                      {stage.label}
                    </span>
                    {stage.isThreadReply && (
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Reply
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {stage.variants[0].subject || '(no subject)'}
                  </p>
                </button>

                {isActive && (
                  <div className="mt-2 ml-2 border-l border-slate-800 pl-3 space-y-1">
                    {stage.variants.map((v, vIdx) => (
                      <div
                        key={v.id}
                        className="flex items-center group"
                      >
                        <button
                          type="button"
                          onClick={() => setActiveVariantId(v.id)}
                          className={`flex-1 text-left text-xs px-2 py-1.5 rounded ${
                            v.id === activeVariant?.id
                              ? 'text-brand-300 bg-brand-500/10'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Variant {String.fromCharCode(65 + vIdx)}
                        </button>
                        {stage.variants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeVariant(stage.id, v.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1"
                            aria-label="Remove variant"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addVariant(stage.id)}
                      className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 px-2 py-1.5"
                    >
                      <Plus className="w-3 h-3" />
                      Add Variant
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </aside>

      {/* Right panel: editor */}
      <section className="min-w-0">
        {activeStage && activeVariant && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-white">
                {activeStage.label}
              </h2>
              {activeStage.isThreadReply && (
                <span className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-800 rounded px-2 py-0.5">
                  Thread Reply
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Subject
                </label>
                <VariableHighlightEditor
                  value={activeVariant.subject}
                  onChange={(v) => updateVariant({ subject: v })}
                  singleLine
                  minHeight={42}
                  placeholder="Subject line"
                  ariaLabel="Subject"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Body
                </label>
                <VariableHighlightEditor
                  value={activeVariant.body}
                  onChange={(v) => updateVariant({ body: v })}
                  minHeight={280}
                  placeholder="Write your email…"
                  ariaLabel="Body"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Use <code className="px-1 py-0.5 bg-slate-800 rounded text-brand-300">{'{{variable_name}}'}</code> to
                  insert personalization tokens.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
