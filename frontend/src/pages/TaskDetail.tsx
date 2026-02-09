import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { tasksApi, projectsApi, sessionsApi, TASK_STATUS } from '../api';
import type { AgentSession, SessionProvider } from '../api';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';
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
  }, [id]);

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
  }, [didInitSession, sessions, activeSession, sessionFromUrl]);

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

  const selectSession = (session: AgentSession | null) => {
    setActiveSession(session);
    const next = new URLSearchParams(searchParams);
    if (session) {
      next.set('session', session.id);
    } else {
      next.delete('session');
    }
    setSearchParams(next, { replace: true });
  };

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

  useKeyboardNav({
    keyMap: {
      Escape: () => navigate('/'),
      s: () => setShowStartSession(true),
      '?': () => setShowHelp(true),
    },
    enabled: !showStartSession && !showHelp,
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
            onShowStartModal={() => setShowStartSession(true)}
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
            onShowStartModal={() => setShowStartSession(true)}
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

      {/* Start Session Modal */}
      {showStartSession && (
        <StartSessionModal
          taskTitle={task.title}
          taskDescription={task.description}
          onClose={() => setShowStartSession(false)}
          onStart={(provider, prompt) => startSessionMutation.mutate({ provider, prompt })}
          isPending={startSessionMutation.isPending}
          error={startSessionMutation.error?.message}
        />
      )}

      {/* Help Overlay */}
      {showHelp && (
        <HelpOverlay page="taskDetail" onClose={() => setShowHelp(false)} />
      )}
    </Layout>
  );
}

interface StartSessionModalProps {
  taskTitle: string;
  taskDescription?: string;
  onClose: () => void;
  onStart: (provider: SessionProvider, prompt: string) => void;
  isPending: boolean;
  error?: string;
}

function StartSessionModal({ taskTitle, taskDescription, onClose, onStart, isPending, error }: StartSessionModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const defaultPrompt = taskDescription
    ? `${taskTitle}\n\n${taskDescription}`
    : taskTitle;

  const [includePrompt, setIncludePrompt] = useState(true);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [provider, setProvider] = useState<SessionProvider>('claude');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (provider === 'terminal') {
      onStart('terminal', '');
    } else {
      onStart(provider, includePrompt ? prompt.trim() : '');
    }
  };

  const providers: { id: SessionProvider; label: string }[] = [
    { id: 'claude', label: 'claude' },
    { id: 'codex', label: 'codex' },
    { id: 'terminal', label: 'terminal' },
  ];

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-lg">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm font-medium">Start Session</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          {/* Provider Toggle */}
          <div>
            <label className="block text-sm text-dim mb-2">Provider</label>
            <div className="flex gap-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={`flex-1 py-2 px-4 text-sm border rounded-md transition-colors ${
                    provider === p.id
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-subtle text-dim hover:bg-tertiary'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt (for claude/codex sessions) */}
          {provider !== 'terminal' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-dim">Initial prompt</label>
                <button
                  type="button"
                  onClick={() => setIncludePrompt(!includePrompt)}
                  className={`text-xs px-2 py-0.5 border rounded-md transition-colors ${
                    includePrompt
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-subtle text-dim'
                  }`}
                >
                  {includePrompt ? 'on' : 'off'}
                </button>
              </div>
              {includePrompt && (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] resize-none"
                  placeholder="What would you like the agent to do?"
                  autoFocus
                />
              )}
            </div>
          )}

          <div className="text-xs text-dim">
            {provider === 'terminal'
              ? 'Opens a terminal in the task\'s worktree directory.'
              : includePrompt
              ? `Starts ${provider} with this prompt in the task's worktree.`
              : `Starts ${provider} interactively in the task's worktree.`}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-sm hover:bg-[var(--color-border)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 py-2 px-4 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {isPending ? 'Starting...' : 'Start'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
