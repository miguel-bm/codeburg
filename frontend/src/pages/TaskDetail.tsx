import { useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePanelNavigation } from '../hooks/usePanelNavigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { tasksApi, projectsApi, sessionsApi, TASK_STATUS } from '../api';
import type { AgentSession, SessionProvider } from '../api';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';
import { useSessionShortcutSettings } from '../stores/keyboard';
import { cleanupAgentSession } from '../lib/sessionCleanup';
import { TaskDetailBacklog } from './task/TaskDetailBacklog';
import { TaskDetailInProgress } from './task/TaskDetailInProgress';
import { TaskDetailInReview } from './task/TaskDetailInReview';
import { TaskDetailDone } from './task/TaskDetailDone';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { closePanel } = usePanelNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [manualSelection, setManualSelection] = useState<{ taskId: string | null; sessionId: string | null }>({
    taskId: id ?? null,
    sessionId: null,
  });
  const [showStartSessionTaskId, setShowStartSessionTaskId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const sessionShortcuts = useSessionShortcutSettings();
  const sessionFromUrl = searchParams.get('session');

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

  const canOpenSessionComposer = task?.status === TASK_STATUS.IN_PROGRESS || task?.status === TASK_STATUS.IN_REVIEW;
  const showStartSession = canOpenSessionComposer && showStartSessionTaskId === (id ?? null);

  const selectSession = useCallback((session: AgentSession | null) => {
    setManualSelection({
      taskId: id ?? null,
      sessionId: session?.id ?? null,
    });
    const next = new URLSearchParams(searchParams);
    if (session) {
      next.set('session', session.id);
    } else {
      next.delete('session');
    }
    setSearchParams(next, { replace: true });
  }, [id, searchParams, setSearchParams]);

  const orderedSessions = useMemo(() => {
    return [...(sessions || [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [sessions]);

  const manualSessionId = manualSelection.taskId === (id ?? null)
    ? manualSelection.sessionId
    : null;
  const selectedSessionId = sessionFromUrl || manualSessionId || orderedSessions[0]?.id || null;
  const activeSession = selectedSessionId
    ? orderedSessions.find((session) => session.id === selectedSessionId) ?? null
    : null;
  const noSessionTabs = canOpenSessionComposer && orderedSessions.length === 0;
  const isSessionComposerVisible = showStartSession || noSessionTabs;

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
      setShowStartSessionTaskId(null);
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: (session: AgentSession) => cleanupAgentSession(session),
    onSuccess: (_data, session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      if (activeSession?.id === session.id) {
        selectSession(null);
      }
    },
  });

  const handleStartSession = (provider: SessionProvider, prompt: string, resumeSessionId?: string) => {
    startSessionMutation.mutate({ provider, prompt, resumeSessionId });
  };

  const handleCloseSession = (session: AgentSession) => {
    closeSessionMutation.mutate(session);
  };

  const keyMap: Record<string, () => void> = {
    Escape: () => closePanel(),
    '?': () => setShowHelp(true),
  };
  if (canOpenSessionComposer) {
    keyMap.s = () => setShowStartSessionTaskId(id ?? null);
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
      <div className="flex items-center justify-center h-full text-dim">
        Loading...
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-dim flex-col gap-2">
        <ClipboardList size={36} className="text-dim" />
        Task not found
      </div>
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
            onShowStartComposer={() => setShowStartSessionTaskId(id ?? null)}
            onHideStartComposer={() => setShowStartSessionTaskId(null)}
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
    <>
      {renderView()}

      {/* Help Overlay */}
      {showHelp && (
        <HelpOverlay page="taskDetail" onClose={() => setShowHelp(false)} />
      )}
    </>
  );
}
