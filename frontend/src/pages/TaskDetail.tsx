import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { SessionView, SessionTabs } from '../components/session';
import { JustfilePanel } from '../components/justfile';
import { TunnelPanel } from '../components/tunnel';
import { tasksApi, projectsApi, sessionsApi } from '../api';
import type { AgentSession, SessionProvider } from '../api';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';

type RightPanel = 'session' | 'justfile' | 'tunnel';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [showStartSession, setShowStartSession] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>('session');

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

  const hasActiveSession = sessions?.some(
    (s) => s.status === 'running' || s.status === 'waiting_input'
  );

  useKeyboardNav({
    keyMap: {
      Escape: () => navigate('/'),
      s: () => { if (!hasActiveSession) setShowStartSession(true); },
      '1': () => setRightPanel('session'),
      '2': () => setRightPanel('justfile'),
      '3': () => setRightPanel('tunnel'),
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

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="bg-secondary border-b border-subtle px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/')}
                className="text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                &lt; back
              </button>
              <div>
                <h1 className="text-lg font-medium">{task.title}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-dim">
                    {project?.name || 'unknown'}
                  </span>
                  <StatusBadge status={task.status} />
                  {task.branch && (
                    <span className="text-xs text-dim font-mono">
                      [{task.branch}]
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {activeSession && (
                <button
                  onClick={() => stopSessionMutation.mutate(activeSession.id)}
                  disabled={stopSessionMutation.isPending}
                  className="px-4 py-2 border border-[var(--color-error)] text-[var(--color-error)] text-sm hover:bg-[var(--color-error)] hover:text-[var(--color-bg-primary)] transition-colors"
                >
                  stop
                </button>
              )}
              {!hasActiveSession && (
                <button
                  onClick={() => setShowStartSession(true)}
                  className="px-4 py-2 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors"
                >
                  + session
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Panel Tabs */}
          <div className="flex border-b border-subtle bg-secondary">
            <button
              onClick={() => setRightPanel('session')}
              className={`px-4 py-2 text-sm transition-colors ${
                rightPanel === 'session'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-dim hover:text-[var(--color-text-primary)]'
              }`}
            >
              agent
            </button>
            <button
              onClick={() => setRightPanel('justfile')}
              className={`px-4 py-2 text-sm transition-colors ${
                rightPanel === 'justfile'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-dim hover:text-[var(--color-text-primary)]'
              }`}
            >
              justfile
            </button>
            <button
              onClick={() => setRightPanel('tunnel')}
              className={`px-4 py-2 text-sm transition-colors ${
                rightPanel === 'tunnel'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-dim hover:text-[var(--color-text-primary)]'
              }`}
            >
              tunnels
            </button>
          </div>

          {/* Session Tabs */}
          {rightPanel === 'session' && sessions && sessions.length > 0 && (
            <SessionTabs
              sessions={sessions}
              activeSessionId={activeSession?.id}
              onSelect={(session) => {
                setActiveSession(session);
                setRightPanel('session');
              }}
              onResume={(session) => {
                startSessionMutation.mutate({
                  provider: 'claude',
                  prompt: '',
                  resumeSessionId: session.id,
                });
              }}
              onNewSession={() => setShowStartSession(true)}
              hasActiveSession={!!hasActiveSession}
            />
          )}

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden">
            {rightPanel === 'session' ? (
              activeSession ? (
                <SessionView session={activeSession} />
              ) : (
                <TaskInfo task={task} project={project} />
              )
            ) : rightPanel === 'justfile' ? (
              <JustfilePanel taskId={id!} />
            ) : (
              <TunnelPanel taskId={id!} />
            )}
          </div>
        </div>
      </div>

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

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const statusColors: Record<string, string> = {
    backlog: 'status-backlog',
    in_progress: 'status-in-progress',
    in_review: 'status-in-review',
    done: 'status-done',
  };

  return (
    <span className={`text-xs ${statusColors[status] || 'text-dim'}`}>
      [{status}]
    </span>
  );
}

interface TaskInfoProps {
  task: {
    title: string;
    description?: string;
    status: string;
    branch?: string;
    worktreePath?: string;
    createdAt: string;
    startedAt?: string;
  };
  project?: {
    name: string;
    path: string;
  };
}

function TaskInfo({ task, project }: TaskInfoProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        {/* Description */}
        {task.description && (
          <div>
            <h3 className="text-sm text-dim mb-2">// description</h3>
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        {/* Details */}
        <div>
          <h3 className="text-sm text-dim mb-2">// details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex gap-4">
              <span className="text-dim w-24">status</span>
              <span>{task.status}</span>
            </div>
            {task.branch && (
              <div className="flex gap-4">
                <span className="text-dim w-24">branch</span>
                <span className="font-mono">{task.branch}</span>
              </div>
            )}
            {task.worktreePath && (
              <div className="flex gap-4">
                <span className="text-dim w-24">worktree</span>
                <span className="font-mono text-xs">{task.worktreePath}</span>
              </div>
            )}
            {project && (
              <div className="flex gap-4">
                <span className="text-dim w-24">project</span>
                <span>{project.name}</span>
              </div>
            )}
            <div className="flex gap-4">
              <span className="text-dim w-24">created</span>
              <span>{new Date(task.createdAt).toLocaleString()}</span>
            </div>
            {task.startedAt && (
              <div className="flex gap-4">
                <span className="text-dim w-24">started</span>
                <span>{new Date(task.startedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <h3 className="text-sm text-dim mb-2">// getting_started</h3>
          <p className="text-sm text-dim">
            Click "+ session" to start an AI agent session for this task.
            The agent will work in the task's worktree directory.
          </p>
        </div>
      </div>
    </div>
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
