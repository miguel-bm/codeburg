import type { AgentSession } from '../../api/sessions';

interface SessionListProps {
  sessions: AgentSession[];
  activeSessionId?: string;
  onSelect: (session: AgentSession) => void;
}

export function SessionList({ sessions, activeSessionId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-dim">
        // no_sessions
      </div>
    );
  }

  return (
    <div className="divide-y divide-subtle">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSelect(session)}
          className={`w-full px-4 py-3 text-left transition-colors ${
            session.id === activeSessionId
              ? 'bg-accent/10 border-l-2 border-accent'
              : 'hover:bg-secondary'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono">
              {session.id.slice(0, 8)}...
            </span>
            <SessionStatusBadge status={session.status} />
          </div>
          <div className="text-xs text-dim mt-1">
            {session.provider} · {formatDate(session.createdAt)}
          </div>
        </button>
      ))}
    </div>
  );
}

interface SessionStatusBadgeProps {
  status: string;
}

function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const getStatusStyle = () => {
    switch (status) {
      case 'running':
        return 'status-in-progress';
      case 'waiting_input':
        return 'status-blocked';
      case 'completed':
        return 'status-done';
      case 'error':
        return 'text-[var(--color-status-blocked)]';
      default:
        return 'text-dim';
    }
  };

  return (
    <span className={`text-xs ${getStatusStyle()}`}>
      [{status}]
    </span>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
