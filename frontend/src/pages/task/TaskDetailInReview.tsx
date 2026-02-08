import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { SessionView, SessionTabs } from '../../components/session';
import { DiffView } from '../../components/git';
import { tasksApi } from '../../api';
import type { Task, Project, AgentSession, SessionProvider } from '../../api';

type MainContent =
  | { type: 'diff' }
  | { type: 'session' };

interface Props {
  task: Task;
  project?: Project;
  sessions: AgentSession[];
  activeSession: AgentSession | null;
  onSelectSession: (session: AgentSession) => void;
  onStartSession: (provider: SessionProvider, prompt: string, resumeSessionId?: string) => void;
  onCloseSession: (session: AgentSession) => void;
  onShowStartModal: () => void;
}

export function TaskDetailInReview({
  task, project, sessions, activeSession,
  onSelectSession, onStartSession, onCloseSession, onShowStartModal,
}: Props) {
  const queryClient = useQueryClient();
  const [mainContent, setMainContent] = useState<MainContent>({ type: 'diff' });

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    },
  });

  const handleBackToProgress = () => {
    updateTask.mutate({ status: 'in_progress' });
  };

  const handleMarkDone = () => {
    updateTask.mutate({ status: 'done' });
  };

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <>
            <button
              onClick={handleBackToProgress}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 border border-subtle text-dim text-xs hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors disabled:opacity-50"
            >
              back to wip
            </button>
            <button
              onClick={handleMarkDone}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 border border-accent text-accent text-xs hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              done
            </button>
          </>
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs: diff vs sessions */}
        <div className="flex items-center border-b border-subtle bg-secondary">
          <button
            onClick={() => setMainContent({ type: 'diff' })}
            className={`px-4 py-2 text-xs transition-colors ${
              mainContent.type === 'diff'
                ? 'text-accent border-b-2 border-accent'
                : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
          >
            diff
          </button>
          {sessions.length > 0 && (
            <SessionTabs
              sessions={sessions}
              activeSessionId={mainContent.type === 'session' ? activeSession?.id : undefined}
              onSelect={(session) => {
                onSelectSession(session);
                setMainContent({ type: 'session' });
              }}
              onResume={(session) => {
                onStartSession('claude', '', session.id);
              }}
              onClose={onCloseSession}
              onNewSession={onShowStartModal}
            />
          )}
        </div>

        {/* PR link */}
        {task.prUrl && (
          <div className="px-4 py-2 border-b border-subtle bg-secondary text-xs">
            <span className="text-dim">PR: </span>
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-mono"
            >
              {task.prUrl}
            </a>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {mainContent.type === 'diff' ? (
            <div className="h-full overflow-auto">
              <DiffView taskId={task.id} base />
            </div>
          ) : activeSession ? (
            <SessionView session={activeSession} />
          ) : (
            <div className="flex items-center justify-center h-full text-dim text-sm">
              select a session
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
