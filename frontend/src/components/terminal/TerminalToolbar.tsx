import { useState, useCallback } from 'react';

interface TerminalToolbarProps {
  onInput: (data: string) => void;
}

const KEYS = [
  { label: 'esc', data: '\x1b' },
  { label: 'tab', data: '\t' },
  { label: '^C', data: '\x03' },
  { label: '^D', data: '\x04' },
  { label: '^Z', data: '\x1a' },
  { label: '\u2191', data: '\x1b[A' },  // ↑
  { label: '\u2193', data: '\x1b[B' },  // ↓
  { label: '\u2190', data: '\x1b[D' },  // ←
  { label: '\u2192', data: '\x1b[C' },  // →
  { label: '\u21B5', data: '\r' },       // ↵ (enter)
] as const;

export function TerminalToolbar({ onInput }: TerminalToolbarProps) {
  const [flash, setFlash] = useState<number | null>(null);

  const handlePress = useCallback((index: number, data: string) => {
    onInput(data);
    setFlash(index);
    setTimeout(() => setFlash(null), 100);
  }, [onInput]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-[#111] border-t border-subtle overflow-x-auto">
      {KEYS.map((key, i) => (
        <button
          key={key.label}
          onTouchStart={(e) => {
            e.preventDefault();
            handlePress(i, key.data);
          }}
          onClick={() => handlePress(i, key.data)}
          className={`flex-shrink-0 px-3 py-2 text-xs font-mono border transition-colors select-none
            ${flash === i
              ? 'bg-accent text-[#0a0a0a] border-accent'
              : 'bg-[#1a1a1a] text-dim border-subtle active:bg-accent active:text-[#0a0a0a]'
            }`}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
