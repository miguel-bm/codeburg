import type { AgentSession, SessionStatus } from '../../api/sessions';

interface Props {
  sessions: AgentSession[];
  activeSessionId?: string;
  onSelect: (session: AgentSession) => void;
  onResume?: (session: AgentSession) => void;
  onNewSession: () => void;
  hasActiveSession: boolean;
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

export function SessionTabs({ sessions, activeSessionId, onSelect, onResume, onNewSession, hasActiveSession }: Props) {
  // Sort by createdAt to get stable 1-indexed numbers
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="flex items-center border-b border-subtle bg-secondary overflow-x-auto">
      {sorted.map((session, i) => {
        const isActive = session.id === activeSessionId;
        const canResume = onResume && session.provider === 'claude' && session.status === 'completed';

        return (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors whitespace-nowrap ${
              isActive
                ? 'border-b-2 border-accent text-accent bg-accent/10'
                : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
          >
            <div className={`w-1.5 h-1.5 ${getStatusDotClass(session.status)}`} />
            <span>#{i + 1}</span>
            <span className="text-dim">{session.provider}</span>
            {canResume && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onResume!(session);
                }}
                className="text-accent hover:underline ml-1"
              >
                resume
              </span>
            )}
          </button>
        );
      })}
      <button
        onClick={onNewSession}
        disabled={hasActiveSession}
        className="px-3 py-2 text-xs text-dim hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  );
}
