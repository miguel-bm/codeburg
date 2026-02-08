import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { tasksApi, projectsApi, sessionsApi } from '../api';
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
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [showStartSession, setShowStartSession] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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

  // Reset active session when navigating to a different task
  useEffect(() => {
    setActiveSession(null);
  }, [id]);

  // Auto-select session from URL param or first active session
  useEffect(() => {
    if (!sessions) return;
    if (sessionFromUrl) {
      const match = sessions.find((s) => s.id === sessionFromUrl);
      if (match) {
        setActiveSession(match);
        return;
      }
    }
    if (!activeSession) {
      const active = sessions.find((s) => s.status === 'running' || s.status === 'waiting_input');
      if (active) setActiveSession(active);
    }
  }, [sessionFromUrl, sessions, id, activeSession]);

  // Keep activeSession in sync with polling data
  useEffect(() => {
    if (activeSession && sessions) {
      const updated = sessions.find((s) => s.id === activeSession.id);
      if (updated && (updated.status !== activeSession.status || updated.lastActivityAt !== activeSession.lastActivityAt)) {
        setActiveSession(updated);
      }
    }
  }, [sessions, activeSession]);

  const startSessionMutation = useMutation({
    mutationFn: ({ provider, prompt, resumeSessionId }: { provider: SessionProvider; prompt: string; resumeSessionId?: string }) =>
      sessionsApi.start(id!, { provider, prompt: prompt || undefined, resumeSessionId }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      setActiveSession(session);
      setShowStartSession(false);
    },
  });

  const stopSessionMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.stop(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      setActiveSession(null);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.delete(sessionId),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      if (activeSession?.id === deletedId) {
        setActiveSession(null);
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
          loading...
        </div>
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-dim">
          task not found
        </div>
      </Layout>
    );
  }

  const renderView = () => {
    switch (task.status) {
      case 'backlog':
        return <TaskDetailBacklog task={task} project={project} />;

      case 'in_progress':
        return (
          <TaskDetailInProgress
            task={task}
            project={project}
            sessions={sessions || []}
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            onStartSession={handleStartSession}
            onCloseSession={handleCloseSession}
            onShowStartModal={() => setShowStartSession(true)}
          />
        );

      case 'in_review':
        return (
          <TaskDetailInReview
            task={task}
            project={project}
            sessions={sessions || []}
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            onStartSession={handleStartSession}
            onCloseSession={handleCloseSession}
            onShowStartModal={() => setShowStartSession(true)}
          />
        );

      case 'done':
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
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-lg">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// start_session</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          {/* Provider Toggle */}
          <div>
            <label className="block text-sm text-dim mb-2">provider</label>
            <div className="flex gap-0">
              {providers.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={`flex-1 py-2 px-4 text-sm border transition-colors ${
                    i > 0 ? 'border-l-0' : ''
                  } ${
                    provider === p.id
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-subtle text-dim hover:text-[var(--color-text-primary)]'
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
                <label className="text-sm text-dim">initial prompt</label>
                <button
                  type="button"
                  onClick={() => setIncludePrompt(!includePrompt)}
                  className={`text-xs px-2 py-0.5 border transition-colors ${
                    includePrompt
                      ? 'border-accent text-accent'
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
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none resize-none"
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
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              {isPending ? 'starting...' : 'start'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
