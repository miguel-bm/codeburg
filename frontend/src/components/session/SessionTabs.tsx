import type { AgentSession, SessionStatus } from '../../api/sessions';

interface Props {
  sessions: AgentSession[];
  activeSessionId?: string;
  onSelect: (session: AgentSession) => void;
  onResume?: (session: AgentSession) => void;
  onClose?: (session: AgentSession) => void;
  onNewSession: () => void;
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

export function SessionTabs({ sessions, activeSessionId, onSelect, onResume, onClose, onNewSession }: Props) {
  // Sort by createdAt to get stable 1-indexed numbers
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="flex items-center border-b border-subtle bg-secondary overflow-x-auto">
      {sorted.map((session, i) => {
        const isActive = session.id === activeSessionId;
        const canResume = onResume && session.provider === 'claude' && session.status === 'completed';
        const canClose = onClose && session.status !== 'idle';

        return (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors whitespace-nowrap border-b-2 ${
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
                className="text-dim hover:text-[var(--color-error)] transition-colors ml-0.5"
                title={session.status === 'running' || session.status === 'waiting_input' ? 'Stop session' : 'Delete session'}
              >
                x
              </span>
            )}
          </button>
        );
      })}
      <button
        onClick={onNewSession}
        className="px-3 py-2 text-xs text-dim hover:text-accent transition-colors border-b-2 border-transparent"
      >
        +
      </button>
    </div>
  );
}
