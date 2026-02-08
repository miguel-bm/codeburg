import { useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { useMobile } from '../../hooks/useMobile';
import { TerminalToolbar } from '../terminal/TerminalToolbar';

interface TerminalViewProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  sessionId?: string; // Codeburg session ID for activity tracking
}

export function TerminalView({ target, sessionId }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { sendInput } = useTerminal(terminalRef, target, { sessionId });
  const isMobile = useMobile();

  return (
    <div className="flex flex-col h-full">
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 bg-[#0a0a0a] p-1"
      />
      {isMobile && <TerminalToolbar onInput={sendInput} />}
    </div>
  );
}
