import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { SessionView, SessionTabs } from '../../components/session';
import { DiffView } from '../../components/git';
import { tasksApi, invalidateTaskQueries, gitApi } from '../../api';
import { TASK_STATUS } from '../../api';
import type { Task, Project, AgentSession, SessionProvider, UpdateTaskResponse } from '../../api';

type MainContent =
  | { type: 'diff'; file?: string }
  | { type: 'session' };

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Parse diff --git headers to extract file paths and +/- counts */
function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const chunks = diff.split(/^diff --git /m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    // Extract path from "a/path b/path"
    const headerMatch = chunk.match(/^a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;
    const path = headerMatch[2];
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    files.push({ path, additions, deletions });
  }
  return files;
}

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
  const [warning, setWarning] = useState<string | null>(null);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: (data: UpdateTaskResponse) => {
      invalidateTaskQueries(queryClient, data.id);
      if (data.worktreeWarning?.length) {
        setWarning(data.worktreeWarning.join('; '));
      }
      if (data.workflowError) {
        setWarning((prev) => prev ? `${prev}; ${data.workflowError}` : data.workflowError!);
      }
    },
  });

  const createPR = useMutation({
    mutationFn: () => tasksApi.createPR(task.id),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
    onError: (err: Error) => setWarning(err.message),
  });

  // Fetch git status for branch info (ahead/behind)
  const { data: gitStatus } = useQuery({
    queryKey: ['git-status', task.id],
    queryFn: () => gitApi.status(task.id),
    enabled: !!task.worktreePath,
  });

  // Fetch the base diff for file navigation
  const { data: baseDiff } = useQuery({
    queryKey: ['git-diff', task.id, undefined, undefined, true],
    queryFn: () => gitApi.diff(task.id, { base: true }),
  });

  const diffFiles = useMemo(() => {
    if (!baseDiff?.diff) return [];
    return parseDiffFiles(baseDiff.diff);
  }, [baseDiff]);

  const handleBackToProgress = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const handleMarkDone = () => {
    updateTask.mutate({ status: TASK_STATUS.DONE });
  };

  const handleCreatePR = () => {
    createPR.mutate();
  };

  const selectedFile = mainContent.type === 'diff' ? mainContent.file : undefined;

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

      {/* Warning Banner */}
      {warning && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
          <span>{warning}</span>
          <button onClick={() => setWarning(null)} className="ml-4 hover:text-[var(--color-text-primary)] transition-colors">
            Dismiss
          </button>
        </div>
      )}

      {/* Branch info bar */}
      {(task.branch || task.diffStats || gitStatus) && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-subtle bg-secondary text-xs">
          {task.branch && (
            <span className="font-mono text-dim">{task.branch}</span>
          )}
          {task.diffStats && (
            <span>
              <span className="text-[var(--color-success)]">+{task.diffStats.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{task.diffStats.deletions}</span>
            </span>
          )}
          {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <span className="text-dim">
              {gitStatus.ahead > 0 && <span>{gitStatus.ahead} ahead</span>}
              {gitStatus.ahead > 0 && gitStatus.behind > 0 && ', '}
              {gitStatus.behind > 0 && <span>{gitStatus.behind} behind</span>}
            </span>
          )}
        </div>
      )}

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
            Diff {diffFiles.length > 0 && `(${diffFiles.length})`}
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

        {/* PR section */}
        <div className="px-4 py-2 border-b border-subtle bg-secondary text-xs flex items-center gap-2">
          {task.prUrl ? (
            <>
              <span className="text-dim">PR:</span>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-mono truncate"
              >
                {task.prUrl}
              </a>
            </>
          ) : (
            <button
              onClick={handleCreatePR}
              disabled={createPR.isPending}
              className="px-2 py-1 bg-accent text-white rounded text-xs hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createPR.isPending ? 'Creating PR...' : 'Push & Create PR'}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {mainContent.type === 'diff' ? (
            <div className="flex h-full">
              {/* File list sidebar */}
              {diffFiles.length > 0 && (
                <div className="w-56 shrink-0 border-r border-subtle overflow-y-auto bg-secondary">
                  <button
                    onClick={() => setMainContent({ type: 'diff' })}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      !selectedFile ? 'bg-accent/10 text-accent' : 'text-dim hover:bg-tertiary'
                    }`}
                  >
                    All files ({diffFiles.length})
                  </button>
                  {diffFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setMainContent({ type: 'diff', file: f.path })}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                        selectedFile === f.path ? 'bg-accent/10 text-accent' : 'text-dim hover:bg-tertiary'
                      }`}
                      title={f.path}
                    >
                      <span className="font-mono">{f.path.split('/').pop()}</span>
                      <span className="ml-1 text-[var(--color-success)]">+{f.additions}</span>
                      <span className="ml-0.5 text-[var(--color-error)]">-{f.deletions}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Diff content */}
              <div className="flex-1 overflow-auto">
                <DiffView taskId={task.id} base file={selectedFile} />
              </div>
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
