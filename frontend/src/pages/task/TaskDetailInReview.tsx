import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { SessionView, SessionTabs } from '../../components/session';
import { DiffView } from '../../components/git';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api';
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
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
  });

  const handleBackToProgress = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const handleMarkDone = () => {
    updateTask.mutate({ status: TASK_STATUS.DONE });
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
              className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50"
            >
              Back to WIP
            </button>
            <button
              onClick={handleMarkDone}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 bg-accent text-white rounded-md font-medium text-xs hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              Done
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
            Diff
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
              Select a session
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
