import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { sessionsApi } from '../api';
import { SessionView } from '../components/session';
import type { SessionStatus } from '../api';

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
  const originalTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : 'Codeburg');
  const previousUpdateRef = useRef<{ status?: SessionStatus; lastActivityAt?: string }>({});
  const [unreadUpdate, setUnreadUpdate] = useState(false);

  const { data: session, isLoading, isError } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  // Mark unseen updates while this tab is in background.
  useEffect(() => {
    if (!session) return;

    const previous = previousUpdateRef.current;
    const activityChanged = !!session.lastActivityAt && session.lastActivityAt !== previous.lastActivityAt;
    const enteredWaitingInput = session.status === 'waiting_input' && previous.status !== 'waiting_input';

    if (document.hidden && (activityChanged || enteredWaitingInput)) {
      setUnreadUpdate(true);
    }

    previousUpdateRef.current = {
      status: session.status,
      lastActivityAt: session.lastActivityAt,
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
    return () => {
      document.title = originalTitleRef.current;
    };
  }, []);

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
    document.title = `${unread}${waiting}${statusLabel(session.status)} · ${session.provider} · ${session.id.slice(0, 8)} · Codeburg`;
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
