import { useMemo, useRef, useState } from 'react';
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
  const debugEnabled = useMemo(() => {
    try {
      const search = new URLSearchParams(window.location.search);
      return search.get('termdebug') === '1' || localStorage.getItem('codeburg:terminal-debug') === '1';
    } catch {
      return false;
    }
  }, []);
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  const pushDebug = (message: string) => {
    setDebugEvents((prev) => [message, ...prev].slice(0, 6));
  };
  const { sendInput, actions } = useTerminal(terminalRef, target, { sessionId, sessionStatus, debug: debugEnabled, onDebugEvent: pushDebug });
  const isMobile = useMobile();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 relative">
        <div
          ref={terminalRef}
          className="absolute inset-0 bg-[#0a0a0a] p-1 select-none"
          onContextMenu={handleContextMenu}
        />
        {debugEnabled && (
          <div className="absolute top-2 right-2 z-40 bg-black/70 text-[10px] text-green-300 font-mono rounded px-2 py-1 max-w-[60%] pointer-events-none">
            <div className="text-[9px] text-green-400/80 mb-1">terminal debug</div>
            {debugEvents.length === 0 ? (
              <div>no events yet</div>
            ) : (
              debugEvents.map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))
            )}
          </div>
        )}
      </div>
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
