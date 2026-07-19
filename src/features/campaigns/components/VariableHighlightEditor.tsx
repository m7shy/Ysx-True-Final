import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { tokenizeTemplate } from '../utils';

interface VariableHighlightEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  singleLine?: boolean;
  ariaLabel?: string;
}

// A textarea with a visually-aligned overlay underneath. The textarea's text is
// made fully transparent so the highlighted overlay shows through while the
// native caret/selection remain functional.
export const VariableHighlightEditor: React.FC<VariableHighlightEditorProps> = ({
  value,
  onChange,
  placeholder,
  minHeight = 180,
  singleLine = false,
  ariaLabel,
}) => {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const syncScroll = useCallback(() => {
    if (!taRef.current || !overlayRef.current) return;
    overlayRef.current.scrollTop = taRef.current.scrollTop;
    overlayRef.current.scrollLeft = taRef.current.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    if (!taRef.current || singleLine) return;
    const el = taRef.current;
    el.style.height = 'auto';
    const h = Math.max(minHeight, el.scrollHeight);
    el.style.height = `${h}px`;
    if (overlayRef.current) {
      overlayRef.current.style.height = `${h}px`;
    }
  }, [value, minHeight, singleLine]);

  const tokens = tokenizeTemplate(value);

  const shared = `font-mono text-sm leading-6 px-3 py-2 ${
    singleLine
      ? 'whitespace-pre overflow-x-auto overflow-y-hidden'
      : 'whitespace-pre-wrap break-words'
  }`;

  return (
    <div
      className="relative rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-volt-text transition-colors"
      style={{ minHeight }}
    >
      {/* Rendered highlighted text layer (visible). */}
      <div
        ref={overlayRef}
        aria-hidden
        className={`${shared} absolute inset-0 pointer-events-none text-neutral-300`}
        style={{ minHeight }}
      >
        {tokens.length === 0 && placeholder ? (
          <span className="text-neutral-500">{placeholder}</span>
        ) : (
          tokens.map((tok, idx) =>
            tok.kind === 'var' ? (
              <span
                key={idx}
                className="bg-volt/20 text-volt-text border border-volt-text/40 rounded-md px-1"
              >
                {'{{' + tok.value + '}}'}
              </span>
            ) : (
              <span key={idx}>{tok.value}</span>
            )
          )
        )}
        <span>&nbsp;</span>
      </div>
      {/* Invisible editable textarea on top for native caret/selection. */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder=""
        aria-label={ariaLabel}
        spellCheck={false}
        rows={singleLine ? 1 : 6}
        className={`${shared} relative w-full bg-transparent resize-none focus:outline-none`}
        style={{
          minHeight,
          color: 'transparent',
          caretColor: 'white',
          WebkitTextFillColor: 'transparent',
        }}
      />
    </div>
  );
};
