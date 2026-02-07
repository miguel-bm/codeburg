import { TerminalView } from './TerminalView';
import type { AgentSession, SessionStatus } from '../../api/sessions';

interface SessionViewProps {
  session: AgentSession;
}

export function SessionView({ session }: SessionViewProps) {
  const tmuxTarget = session.tmuxWindow
    ? `codeburg:${session.tmuxWindow}${session.tmuxPane ? '.' + session.tmuxPane : ''}`
    : undefined;

  if (!tmuxTarget) {
    return (
      <div className="flex items-center justify-center h-full text-dim">
        // no terminal target
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-3">
          <StatusIndicator status={session.status} />
          <span className="text-xs text-dim">{session.provider}</span>
          <span className="text-sm text-dim">
            session: {session.id.slice(0, 8)}...
          </span>
        </div>
        {session.lastActivityAt && (
          <ActivityIndicator lastActivityAt={session.lastActivityAt} />
        )}
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <TerminalView target={tmuxTarget} sessionId={session.id} />
      </div>
    </div>
  );
}

interface StatusIndicatorProps {
  status: SessionStatus;
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'bg-accent animate-pulse';
      case 'waiting_input':
        return 'bg-[var(--color-status-in-progress)]';
      case 'completed':
        return 'bg-[var(--color-status-done)]';
      case 'error':
        return 'bg-[var(--color-error)]';
      default:
        return 'bg-[var(--color-text-dim)]';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'running';
      case 'waiting_input':
        return 'waiting';
      case 'completed':
        return 'done';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 ${getStatusColor()}`} />
      <span className="text-xs text-dim">{getStatusText()}</span>
    </div>
  );
}

interface ActivityIndicatorProps {
  lastActivityAt: string;
}

function ActivityIndicator({ lastActivityAt }: ActivityIndicatorProps) {
  const lastActivity = new Date(lastActivityAt);
  const secondsAgo = Math.floor((Date.now() - lastActivity.getTime()) / 1000);

  if (secondsAgo < 10) {
    return (
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 bg-accent animate-pulse" />
        <span className="text-xs text-dim">active</span>
      </div>
    );
  }

  return null;
}
