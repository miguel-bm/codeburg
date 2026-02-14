import { useMemo, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { TerminalView } from './TerminalView';
import { ChatSessionView } from '../chat';
import type { AgentSession, SessionStatus } from '../../api/sessions';
import { getSessionStatusMeta } from '../../lib/sessionStatus';

interface SessionViewProps {
  session: AgentSession;
  showOpenInNewTab?: boolean;
  onResume?: () => Promise<unknown> | unknown;
}

export function SessionView({ session, showOpenInNewTab = true, onResume }: SessionViewProps) {
  const openSessionHref = useMemo(() => {
    return `/tasks/${session.taskId}/session/${session.id}`;
  }, [session.id, session.taskId]);
  const [copied, setCopied] = useState(false);

  const copySessionID = async () => {
    try {
      await navigator.clipboard.writeText(session.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-3 min-w-0">
          <StatusIndicator status={session.status} />
          <span className="text-xs text-dim">{session.provider}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-subtle text-dim uppercase tracking-[0.08em]">
            {session.sessionType}
          </span>
          <div className="inline-flex min-w-0 items-center gap-1.5 rounded border border-subtle bg-primary px-2 py-0.5">
            <span className="text-[11px] text-dim">session:</span>
            <span className="font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{session.id}</span>
            <button
              type="button"
              onClick={() => { void copySessionID(); }}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-dim hover:text-accent hover:bg-accent/10 transition-colors"
              title={copied ? 'Copied' : 'Copy session ID'}
              aria-label="Copy session ID"
            >
              {copied ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
            </button>
          </div>
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
        {session.sessionType === 'chat' ? (
          <ChatSessionView session={session} onResume={onResume} />
        ) : (
          <TerminalView sessionId={session.id} sessionStatus={session.status} />
        )}
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
  const [now, setNow] = useState(() => Date.now());
  const lastActivity = new Date(lastActivityAt);
  const secondsAgo = Math.floor((now - lastActivity.getTime()) / 1000);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
