import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react';
import { haptic } from '../../lib/haptics';

interface TerminalToolbarProps {
  onInput: (data: string) => void;
}

const KEYS: { id: string; label: ReactNode; data: string }[] = [
  { id: 'esc', label: 'esc', data: '\x1b' },
  { id: 'tab', label: 'tab', data: '\t' },
  { id: 'ctrl-c', label: '^C', data: '\x03' },
  { id: 'ctrl-d', label: '^D', data: '\x04' },
  { id: 'ctrl-z', label: '^Z', data: '\x1a' },
  { id: 'up', label: <ArrowUp size={16} />, data: '\x1b[A' },
  { id: 'down', label: <ArrowDown size={16} />, data: '\x1b[B' },
  { id: 'left', label: <ArrowLeft size={16} />, data: '\x1b[D' },
  { id: 'right', label: <ArrowRight size={16} />, data: '\x1b[C' },
  { id: 'enter', label: <CornerDownLeft size={16} />, data: '\r' },
];

export function TerminalToolbar({ onInput }: TerminalToolbarProps) {
  const [flash, setFlash] = useState<string | null>(null);

  const handlePress = useCallback((id: string, data: string) => {
    haptic();
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
          className={`flex-shrink-0 px-3 py-2 text-xs font-mono border rounded-md transition-colors select-none flex items-center justify-center min-w-[36px]
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
