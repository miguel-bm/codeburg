import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { tasksApi, projectsApi, sessionsApi, TASK_STATUS } from '../api';
import type { AgentSession, SessionProvider } from '../api';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';
import { useSessionShortcutSettings } from '../stores/keyboard';
import { TaskDetailBacklog } from './task/TaskDetailBacklog';
import { TaskDetailInProgress } from './task/TaskDetailInProgress';
import { TaskDetailInReview } from './task/TaskDetailInReview';
import { TaskDetailDone } from './task/TaskDetailDone';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [showStartSession, setShowStartSession] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const sessionShortcuts = useSessionShortcutSettings();
  const sessionFromUrl = searchParams.get('session');
  const [didInitSession, setDidInitSession] = useState(false);

  const { data: task, isLoading: taskLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!),
    enabled: !!id,
  });

  const { data: project } = useQuery({
    queryKey: ['project', task?.projectId],
    queryFn: () => projectsApi.get(task!.projectId),
    enabled: !!task?.projectId,
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => sessionsApi.list(id!),
    enabled: !!id,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  // Reset active session when navigating to a different task
  useEffect(() => {
    setActiveSession(null);
    setShowStartSession(false);
  }, [id]);

  const canOpenSessionComposer = task?.status === TASK_STATUS.IN_PROGRESS || task?.status === TASK_STATUS.IN_REVIEW;
  const noSessionTabs = canOpenSessionComposer && (sessions?.length ?? 0) === 0;
  const isSessionComposerVisible = showStartSession || noSessionTabs;

  useEffect(() => {
    if (!canOpenSessionComposer) setShowStartSession(false);
  }, [canOpenSessionComposer]);

  // Auto-select session from URL param only (do not override manual selection)
  useEffect(() => {
    if (!sessions) return;
    if (sessionFromUrl) {
      const match = sessions.find((s) => s.id === sessionFromUrl);
      if (match) {
        setActiveSession(match);
        return;
      }
    }
  }, [sessionFromUrl, sessions, id, activeSession]);

  const selectSession = useCallback((session: AgentSession | null) => {
    setActiveSession(session);
    const next = new URLSearchParams(searchParams);
    if (session) {
      next.set('session', session.id);
    } else {
      next.delete('session');
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Initial default: pick the first session once if none selected
  useEffect(() => {
    if (didInitSession) return;
    if (!sessions || sessions.length === 0) return;
    if (activeSession || sessionFromUrl) {
      setDidInitSession(true);
      return;
    }
    const sorted = [...sessions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    selectSession(sorted[0]);
    setDidInitSession(true);
  }, [didInitSession, sessions, activeSession, sessionFromUrl, selectSession]);

  // Keep activeSession in sync with polling data
  useEffect(() => {
    if (activeSession && sessions) {
      const updated = sessions.find((s) => s.id === activeSession.id);
      if (updated && (updated.status !== activeSession.status || updated.lastActivityAt !== activeSession.lastActivityAt)) {
        setActiveSession(updated);
      }
      if (!updated) {
        setActiveSession(null);
      }
    }
  }, [sessions, activeSession]);

  const orderedSessions = useMemo(() => {
    return [...(sessions || [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [sessions]);

  const cycleSession = useCallback((offset: 1 | -1) => {
    if (orderedSessions.length === 0) return;
    if (orderedSessions.length === 1) {
      selectSession(orderedSessions[0]);
      return;
    }

    const currentIndex = activeSession
      ? orderedSessions.findIndex((session) => session.id === activeSession.id)
      : -1;

    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + offset + orderedSessions.length) % orderedSessions.length;
    selectSession(orderedSessions[nextIndex]);
  }, [activeSession, orderedSessions, selectSession]);

  const startSessionMutation = useMutation({
    mutationFn: ({ provider, prompt, resumeSessionId }: { provider: SessionProvider; prompt: string; resumeSessionId?: string }) =>
      sessionsApi.start(id!, { provider, prompt: prompt || undefined, resumeSessionId }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      selectSession(session);
      setShowStartSession(false);
    },
  });

  const stopSessionMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.stop(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      selectSession(null);
      deleteSessionMutation.mutate(sessionId);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.delete(sessionId),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      if (activeSession?.id === deletedId) {
        selectSession(null);
      }
    },
  });

  const handleStartSession = (provider: SessionProvider, prompt: string, resumeSessionId?: string) => {
    startSessionMutation.mutate({ provider, prompt, resumeSessionId });
  };

  const handleCloseSession = (session: AgentSession) => {
    if (session.status === 'running' || session.status === 'waiting_input') {
      stopSessionMutation.mutate(session.id);
    } else {
      deleteSessionMutation.mutate(session.id);
    }
  };

  const keyMap: Record<string, () => void> = {
    Escape: () => navigate('/'),
    '?': () => setShowHelp(true),
  };
  if (canOpenSessionComposer) {
    keyMap.s = () => setShowStartSession(true);
  }

  const nextBindings = Array.from(new Set([
    sessionShortcuts.nextSession,
    'Alt+Shift+ArrowRight',
  ].filter(Boolean)));
  const prevBindings = Array.from(new Set([
    sessionShortcuts.prevSession,
    'Alt+Shift+ArrowLeft',
  ].filter(Boolean)));

  if (orderedSessions.length > 0) {
    for (const binding of nextBindings) {
      if (!keyMap[binding]) keyMap[binding] = () => cycleSession(1);
    }
    for (const binding of prevBindings) {
      if (!keyMap[binding]) keyMap[binding] = () => cycleSession(-1);
    }
  }

  const allowInInputs = orderedSessions.length > 0
    ? Array.from(new Set([...nextBindings, ...prevBindings]))
    : [];

  useKeyboardNav({
    keyMap,
    allowInInputs,
    enabled: !isSessionComposerVisible && !showHelp,
  });

  if (taskLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-dim">
          Loading...
        </div>
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-dim">
          Task not found
        </div>
      </Layout>
    );
  }

  const renderView = () => {
    switch (task.status) {
      case TASK_STATUS.BACKLOG:
        return <TaskDetailBacklog task={task} project={project} />;

      case TASK_STATUS.IN_PROGRESS:
        return (
          <TaskDetailInProgress
            task={task}
            project={project}
            sessions={sessions || []}
            activeSession={activeSession}
            onSelectSession={selectSession}
            onStartSession={handleStartSession}
            onCloseSession={handleCloseSession}
            onShowStartComposer={() => setShowStartSession(true)}
            onHideStartComposer={() => setShowStartSession(false)}
            showStartComposer={showStartSession}
            startSessionPending={startSessionMutation.isPending}
            startSessionError={startSessionMutation.error?.message}
          />
        );

      case TASK_STATUS.IN_REVIEW:
        return (
          <TaskDetailInReview
            task={task}
            project={project}
            sessions={sessions || []}
            activeSession={activeSession}
            onSelectSession={selectSession}
            onStartSession={handleStartSession}
            onCloseSession={handleCloseSession}
            onShowStartComposer={() => setShowStartSession(true)}
            onHideStartComposer={() => setShowStartSession(false)}
            showStartComposer={showStartSession}
            startSessionPending={startSessionMutation.isPending}
            startSessionError={startSessionMutation.error?.message}
          />
        );

      case TASK_STATUS.DONE:
        return <TaskDetailDone task={task} project={project} />;

      default:
        return <TaskDetailBacklog task={task} project={project} />;
    }
  };

  return (
    <Layout>
      {renderView()}

      {/* Help Overlay */}
      {showHelp && (
        <HelpOverlay page="taskDetail" onClose={() => setShowHelp(false)} />
      )}
    </Layout>
  );
}
