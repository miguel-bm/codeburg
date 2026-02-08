import { useEffect, useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { useMobile } from '../../hooks/useMobile';
import { TerminalToolbar } from './TerminalToolbar';

interface TerminalModalProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  onClose: () => void;
}

export function TerminalModal({ target, onClose }: TerminalModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { sendInput } = useTerminal(terminalRef, target);
  const isMobile = useMobile();

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
    <div className="fixed inset-0 z-50 bg-[var(--color-bg-primary)] flex flex-col">
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
        className="flex-1 min-h-0 w-full bg-[#0a0a0a] p-2"
      />

      {/* Mobile Toolbar */}
      {isMobile && <TerminalToolbar onInput={sendInput} />}
    </div>
  );
}
