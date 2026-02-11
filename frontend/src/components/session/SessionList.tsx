import { Terminal } from 'lucide-react';
import type { AgentSession, SessionStatus } from '../../api/sessions';

interface SessionListProps {
  sessions: AgentSession[];
  activeSessionId?: string;
  onSelect: (session: AgentSession) => void;
  onResume?: (session: AgentSession) => void;
}

export function SessionList({ sessions, activeSessionId, onSelect, onResume }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-dim flex flex-col items-center gap-2">
        <Terminal size={32} className="text-dim" />
        No sessions
      </div>
    );
  }

  return (
    <div className="divide-y divide-subtle">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSelect(session)}
          className={`w-full px-4 py-3 text-left rounded-md transition-colors ${
            session.id === activeSessionId
              ? 'bg-accent/10'
              : 'hover:bg-secondary'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono">
              {session.id.slice(0, 8)}...
            </span>
            <SessionStatusBadge status={session.status} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-dim">
              {session.provider} · {formatDate(session.createdAt)}
            </span>
            {onResume && session.provider === 'claude' && session.status === 'completed' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResume(session);
                }}
                className="text-xs text-accent hover:underline"
              >
                resume
              </button>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

interface SessionStatusBadgeProps {
  status: SessionStatus;
}

function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const getStatusStyle = () => {
    switch (status) {
      case 'running':
        return 'status-in-progress';
      case 'waiting_input':
        return 'status-in-review';
      case 'completed':
        return 'status-done';
      case 'error':
        return 'text-[var(--color-error)]';
      default:
        return 'text-dim';
    }
  };

  return (
    <span className={`text-xs rounded-full px-2 py-0.5 ${getStatusStyle()}`}>
      {status.replace('_', ' ')}
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
