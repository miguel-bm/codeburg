import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface TerminalToolbarProps {
  onInput: (data: string) => void;
}

function ArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M8 13V3M3 7l5-5 5 5" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M8 3v10M3 9l5 5 5-5" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M13 8H3M7 3L2 8l5 5" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M3 8h10M9 3l5 5-5 5" />
    </svg>
  );
}

function EnterKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M13 3v6H4M4 9l3-3M4 9l3 3" />
    </svg>
  );
}

const KEYS: { id: string; label: ReactNode; data: string }[] = [
  { id: 'esc', label: 'esc', data: '\x1b' },
  { id: 'tab', label: 'tab', data: '\t' },
  { id: 'ctrl-c', label: '^C', data: '\x03' },
  { id: 'ctrl-d', label: '^D', data: '\x04' },
  { id: 'ctrl-z', label: '^Z', data: '\x1a' },
  { id: 'up', label: <ArrowUp />, data: '\x1b[A' },
  { id: 'down', label: <ArrowDown />, data: '\x1b[B' },
  { id: 'left', label: <ArrowLeft />, data: '\x1b[D' },
  { id: 'right', label: <ArrowRight />, data: '\x1b[C' },
  { id: 'enter', label: <EnterKey />, data: '\r' },
];

export function TerminalToolbar({ onInput }: TerminalToolbarProps) {
  const [flash, setFlash] = useState<string | null>(null);

  const handlePress = useCallback((id: string, data: string) => {
    onInput(data);
    setFlash(id);
    setTimeout(() => setFlash(null), 100);
  }, [onInput]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-[#111] border-t border-subtle overflow-x-auto">
      {KEYS.map((key) => (
        <button
          key={key.id}
          onTouchStart={(e) => {
            e.preventDefault();
            handlePress(key.id, key.data);
          }}
          onClick={() => handlePress(key.id, key.data)}
          className={`flex-shrink-0 px-3 py-2 text-xs font-mono border transition-colors select-none flex items-center justify-center min-w-[36px]
            ${flash === key.id
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
