import { useRef, useState } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { useMobile } from '../../hooks/useMobile';
import { TerminalToolbar } from '../terminal/TerminalToolbar';
import { TerminalContextMenu } from '../terminal/TerminalContextMenu';

interface TerminalViewProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  sessionId?: string; // Codeburg session ID for activity tracking
  sessionStatus?: string; // Current session status (for retry suppression)
}

export function TerminalView({ target, sessionId, sessionStatus }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { sendInput, actions } = useTerminal(terminalRef, target, { sessionId, sessionStatus });
  const isMobile = useMobile();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 bg-[#0a0a0a] p-1 select-none"
        onContextMenu={handleContextMenu}
      />
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
