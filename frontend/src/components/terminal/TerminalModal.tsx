import { useEffect, useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalModalProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  onClose: () => void;
}

export function TerminalModal({ target, onClose }: TerminalModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  useTerminal(terminalRef, target);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.ctrlKey) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-4">
          <span className="text-sm text-accent font-mono">// terminal</span>
          <span className="text-xs text-dim font-mono">{target}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-dim">ctrl+esc to close</span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm border border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
          >
            close
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div
        ref={terminalRef}
        className="h-[calc(100vh-48px)] w-full bg-[#0a0a0a] p-2"
      />
    </div>
  );
}
