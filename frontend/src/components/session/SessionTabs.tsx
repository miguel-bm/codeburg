import type { AgentSession, SessionStatus } from '../../api/sessions';
import { Plus, Sparkles, X } from 'lucide-react';

interface Props {
  sessions: AgentSession[];
  activeSessionId?: string;
  onSelect: (session: AgentSession) => void;
  onResume?: (session: AgentSession) => void;
  onClose?: (session: AgentSession) => void;
  onNewSession: () => void;
  showNewSessionTab?: boolean;
  onCancelNewSession?: () => void;
}

function getStatusDotClass(status: SessionStatus): string {
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
}

export function SessionTabs({
  sessions,
  activeSessionId,
  onSelect,
  onResume,
  onClose,
  onNewSession,
  showNewSessionTab = false,
  onCancelNewSession,
}: Props) {
  // Sort by createdAt to get stable 1-indexed numbers
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="h-10 flex items-center border-b border-subtle bg-secondary overflow-x-auto">
      {sorted.map((session, i) => {
        const isActive = session.id === activeSessionId;
        const canResume = onResume && session.provider === 'claude' && session.status === 'completed';
        const canClose = onClose && session.status !== 'idle';

        return (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className={`h-full flex items-center gap-2 px-3 text-xs transition-colors whitespace-nowrap border-b-2 ${
              isActive
                ? 'border-accent text-accent bg-accent/10'
                : 'border-transparent text-dim hover:text-[var(--color-text-primary)]'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStatusDotClass(session.status)}`} />
            <span>#{i + 1}</span>
            <span className="text-dim">{session.provider}</span>
            {canResume && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onResume!(session);
                }}
                className="text-accent hover:underline"
              >
                Resume
              </span>
            )}
            {canClose && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onClose!(session);
                }}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-dim hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors ml-0.5"
                title={session.status === 'running' || session.status === 'waiting_input' ? 'Stop session' : 'Delete session'}
              >
                <X size={14} />
              </span>
            )}
          </button>
        );
      })}
      {showNewSessionTab && (
        <div className="h-full flex items-center gap-1 px-3 text-xs whitespace-nowrap border-b-2 border-accent text-accent bg-accent/10">
          <Sparkles size={13} />
          <span>new session</span>
          {onCancelNewSession && (
            <button
              onClick={onCancelNewSession}
              className="inline-flex items-center justify-center h-5 w-5 rounded text-dim hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
              title="Cancel new session"
              aria-label="Cancel new session"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <button
        onClick={onNewSession}
        className="inline-flex items-center justify-center h-8 w-8 mx-1 shrink-0 rounded-md transition-colors border-b-2 border-transparent text-dim hover:text-accent hover:bg-accent/10"
        title="New session"
        aria-label="New session"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
