import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { useMobile } from '../../hooks/useMobile';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalContextMenu } from './TerminalContextMenu';

interface TerminalModalProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  onClose: () => void;
}

export function TerminalModal({ target, onClose }: TerminalModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { sendInput, actions } = useTerminal(terminalRef, target);
  const isMobile = useMobile();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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
          <span className="text-sm font-medium">Terminal</span>
          <span className="text-xs text-dim font-mono">{target}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-dim">Ctrl+Esc to close</span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 w-full bg-[#0a0a0a] p-2 select-none"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />

      {/* Mobile Toolbar */}
      {isMobile && <TerminalToolbar onInput={sendInput} />}
      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={actions.hasSelection()}
          onClose={() => setMenu(null)}
          onCopy={actions.copySelection}
          onPaste={actions.pasteClipboard}
          onSelectAll={actions.selectAll}
          onClearSelection={actions.clearSelection}
          onClear={actions.clear}
          onReset={actions.reset}
          onScrollToBottom={actions.scrollToBottom}
        />
      )}
    </div>
  );
}
