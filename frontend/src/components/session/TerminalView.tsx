import { useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalViewProps {
  target: string; // tmux target (e.g., "codeburg:@1.%1")
  sessionId?: string; // Codeburg session ID for activity tracking
}

export function TerminalView({ target, sessionId }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  useTerminal(terminalRef, target, { sessionId });

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#0a0a0a] p-1"
    />
  );
}
