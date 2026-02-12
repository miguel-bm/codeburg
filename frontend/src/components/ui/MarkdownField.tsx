import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  minHeight?: string;
  textSize?: 'sm' | 'xs';
  autoFocus?: boolean;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
}

export function MarkdownField({
  value,
  onChange,
  placeholder = 'Describe the task...',
  rows = 4,
  minHeight = '80px',
  textSize = 'sm',
  autoFocus,
  onKeyDown,
  disabled,
}: MarkdownFieldProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const textClass = textSize === 'xs' ? 'text-xs' : 'text-sm';

  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <button
          type="button"
          onClick={() => setTab('write')}
          className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
            tab === 'write'
              ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-tertiary)]'
              : 'text-dim hover:text-[var(--color-text-secondary)]'
          }`}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
            tab === 'preview'
              ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-tertiary)]'
              : 'text-dim hover:text-[var(--color-text-secondary)]'
          }`}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          disabled={disabled}
          className={`w-full p-0 m-0 border-0 bg-transparent ${textClass} text-[var(--color-text-primary)] focus:outline-none resize-y leading-relaxed`}
          style={{ minHeight }}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      ) : (
        <div style={{ minHeight }}>
          {value.trim() ? (
            <MarkdownRenderer className={textClass}>{value}</MarkdownRenderer>
          ) : (
            <p className={`${textClass} text-dim italic`}>{placeholder}</p>
          )}
        </div>
      )}
    </div>
  );
}
