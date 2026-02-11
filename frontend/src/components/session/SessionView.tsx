import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { TerminalView } from './TerminalView';
import type { AgentSession, SessionStatus } from '../../api/sessions';
import { getSessionStatusMeta } from '../../lib/sessionStatus';

interface SessionViewProps {
  session: AgentSession;
  showOpenInNewTab?: boolean;
}

export function SessionView({ session, showOpenInNewTab = true }: SessionViewProps) {
  const openSessionHref = useMemo(() => {
    return `/tasks/${session.taskId}/session/${session.id}`;
  }, [session.id, session.taskId]);

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-primary">
        <div className="flex items-center gap-3">
          <StatusIndicator status={session.status} />
          <span className="text-xs text-dim">{session.provider}</span>
          <span className="text-sm text-dim">
            session: {session.id.slice(0, 8)}...
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showOpenInNewTab && (
            <a
              href={openSessionHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-dim hover:text-accent hover:bg-accent/10 transition-colors"
              title="Open this session in a new browser tab"
              aria-label="Open this session in a new browser tab"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {session.lastActivityAt && (
            <ActivityIndicator lastActivityAt={session.lastActivityAt} />
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <TerminalView sessionId={session.id} sessionStatus={session.status} />
      </div>
    </div>
  );
}

interface StatusIndicatorProps {
  status: SessionStatus;
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  const { dotClass, label } = getSessionStatusMeta(status);

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span className="text-xs text-dim">{label}</span>
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
        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="text-xs text-dim">Active</span>
      </div>
    );
  }

  return null;
}
