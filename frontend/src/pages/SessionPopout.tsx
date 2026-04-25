import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { sessionsApi } from '../api';
import { SessionView } from '../components/session';
import type { SessionStatus } from '../api';
import { sessionLabel } from '../lib/sessionLabel';
import { useSharedWebSocket } from '../hooks/useSharedWebSocket';

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'waiting_input':
      return 'Waiting input';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function SessionPopout() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { connected, send } = useSharedWebSocket();
  const originalTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : 'Codeburg');
  const previousUpdateRef = useRef<{ status?: SessionStatus; lastActivityAt?: string }>({});
  const [unreadUpdate, setUnreadUpdate] = useState(false);

  const { data: session, isLoading, isError } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: SessionStatus } | undefined)?.status;
      if (status === 'completed' || status === 'error') return false;
      return 5000;
    },
    refetchIntervalInBackground: true,
  });

  // Mark unseen updates while this tab is in background.
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const previous = previousUpdateRef.current;
    const activityChanged = !!session.lastActivityAt && session.lastActivityAt !== previous.lastActivityAt;
    const enteredWaitingInput = session.status === 'waiting_input' && previous.status !== 'waiting_input';

    if (document.hidden && (activityChanged || enteredWaitingInput)) {
      timer = setTimeout(() => setUnreadUpdate(true), 0);
    }

    previousUpdateRef.current = {
      status: session.status,
      lastActivityAt: session.lastActivityAt,
    };
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [session]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        setUnreadUpdate(false);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const originalTitle = originalTitleRef.current;
    return () => {
      document.title = originalTitle;
    };
  }, []);

  useEffect(() => {
    if (!connected || !sessionId) return;

    const report = () => {
      send({
        type: 'session_focus',
        sessionId,
        focused: document.visibilityState === 'visible' && document.hasFocus(),
      });
    };

    report();
    const heartbeat = window.setInterval(report, 10_000);
    const onVisibility = () => report();
    const onFocus = () => report();
    const onBlur = () => report();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      send({ type: 'session_focus', sessionId, focused: false });
    };
  }, [connected, send, sessionId]);

  // Keep title scoped to this single session, with a small unread marker.
  useEffect(() => {
    if (isLoading) {
      document.title = 'Loading session... · Codeburg';
      return;
    }

    if (isError || !session || (id && session.taskId !== id)) {
      document.title = 'Session not found · Codeburg';
      return;
    }

    const unread = unreadUpdate ? '[●] ' : '';
    const waiting = session.status === 'waiting_input' ? '[Waiting] ' : '';
    document.title = `${unread}${waiting}${statusLabel(session.status)} · ${sessionLabel(session)} · Codeburg`;
  }, [id, isError, isLoading, session, unreadUpdate]);

  if (isLoading) {
    return (
      <div className="h-screen bg-primary flex items-center justify-center text-dim text-sm">
        Loading session...
      </div>
    );
  }

  if (isError || !session || (id && session.taskId !== id)) {
    return (
      <div className="h-screen bg-primary flex items-center justify-center text-dim text-sm flex-col gap-2">
        <Terminal size={36} className="text-dim" />
        Session not found
      </div>
    );
  }

  return (
    <div className="h-screen bg-primary">
      <SessionView session={session} showOpenInNewTab={false} />
    </div>
  );
}
