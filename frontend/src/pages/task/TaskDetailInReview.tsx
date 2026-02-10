import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { TaskHeader } from './TaskHeader';
import { TaskGitMetaBar } from './TaskGitMetaBar';
import { NewSessionComposer, SessionView, SessionTabs } from '../../components/session';
import { BaseDiffExplorer } from '../../components/git';
import { tasksApi, invalidateTaskQueries, gitApi } from '../../api';
import { TASK_STATUS } from '../../api';
import type { Task, Project, AgentSession, SessionProvider, UpdateTaskResponse } from '../../api';
import { OpenInEditorButton } from '../../components/common/OpenInEditorButton';
import { useMobile } from '../../hooks/useMobile';

interface Props {
  task: Task;
  project?: Project;
  sessions: AgentSession[];
  activeSession: AgentSession | null;
  onSelectSession: (session: AgentSession) => void;
  onStartSession: (provider: SessionProvider, prompt: string, resumeSessionId?: string) => void;
  onCloseSession: (session: AgentSession) => void;
  onShowStartComposer: () => void;
  onHideStartComposer: () => void;
  showStartComposer: boolean;
  startSessionPending: boolean;
  startSessionError?: string;
}

export function TaskDetailInReview({
  task, project, sessions, activeSession,
  onSelectSession, onStartSession, onCloseSession,
  onShowStartComposer, onHideStartComposer, showStartComposer,
  startSessionPending, startSessionError,
}: Props) {
  const queryClient = useQueryClient();
  const isMobile = useMobile();
  const [diffFileCount, setDiffFileCount] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const showComposer = showStartComposer || sessions.length === 0;
  const containerRef = useRef<HTMLDivElement>(null);

  // Draggable split between diff (top) and session panel (bottom)
  const [splitPct, setSplitPct] = useState(55); // % of height for diff
  const draggingRef = useRef(false);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.max(20, Math.min(80, pct)));
    };
    const onMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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

  const { data: gitStatus } = useQuery({
    queryKey: ['git-status', task.id],
    queryFn: () => gitApi.status(task.id),
    enabled: !!task.worktreePath,
  });

  const handleBackToProgress = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const handleMarkDone = () => {
    updateTask.mutate({ status: TASK_STATUS.DONE });
  };

  const handleCreatePR = () => {
    createPR.mutate();
  };

  // Count active sessions (running or waiting_input)
  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'waiting_input');

  // Auto-open panel when there are active sessions
  const shouldShowPanel = showComposer || sessionPanelOpen || activeSessions.length > 0;

  useEffect(() => {
    if (sessions.length === 0) setSessionPanelOpen(true);
  }, [sessions.length]);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <TaskHeader
          task={task}
          project={project}
          actions={
            <>
              {task.worktreePath && <OpenInEditorButton worktreePath={task.worktreePath} />}
              <button
                onClick={handleBackToProgress}
                disabled={updateTask.isPending}
                className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 inline-flex items-center gap-1"
              >
                <ArrowLeft size={12} />
                Back to WIP
              </button>
              <button
                onClick={handleMarkDone}
                disabled={updateTask.isPending}
                className="px-3 py-1.5 bg-accent text-white rounded-md font-medium text-xs hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Check size={12} />
                Done
              </button>
            </>
          }
        />

        {warning && (
          <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
            <span>{warning}</span>
            <button onClick={() => setWarning(null)} className="ml-4 hover:text-[var(--color-text-primary)] transition-colors">Dismiss</button>
          </div>
        )}

        <TaskGitMetaBar
          task={task}
          onCreatePr={handleCreatePR}
          createPrPending={createPR.isPending}
          createPrPendingLabel="Creating..."
          prLinkClassName="text-accent hover:underline font-mono truncate text-[11px]"
        />

        {/* Mobile: tab between diff and sessions */}
        <div className="flex items-center border-b border-subtle bg-secondary">
          <button
            onClick={() => setSessionPanelOpen(false)}
            className={`px-4 py-2 text-xs transition-colors ${!sessionPanelOpen ? 'text-accent border-b-2 border-accent' : 'text-dim'}`}
          >
            Diff {diffFileCount > 0 && `(${diffFileCount})`}
          </button>
          <button
            onClick={() => setSessionPanelOpen(true)}
            className={`px-4 py-2 text-xs transition-colors ${sessionPanelOpen ? 'text-accent border-b-2 border-accent' : 'text-dim'}`}
          >
            Sessions {activeSessions.length > 0 && `(${activeSessions.length})`}
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {!sessionPanelOpen ? (
            <div className="h-full">
              <BaseDiffExplorer taskId={task.id} onFileCountChange={setDiffFileCount} />
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <SessionTabs
                sessions={sessions}
                activeSessionId={showComposer ? undefined : activeSession?.id}
                onSelect={(session) => {
                  onHideStartComposer();
                  onSelectSession(session);
                }}
                onResume={(session) => {
                  onHideStartComposer();
                  onStartSession('claude', '', session.id);
                }}
                onClose={onCloseSession}
                onNewSession={() => {
                  setSessionPanelOpen(true);
                  onShowStartComposer();
                }}
                showNewSessionTab={showComposer}
                onCancelNewSession={onHideStartComposer}
              />
              <div className="flex-1 overflow-hidden">
                {showComposer ? (
                  <NewSessionComposer
                    taskTitle={task.title}
                    taskDescription={task.description}
                    onStart={(provider, prompt) => onStartSession(provider, prompt)}
                    onCancel={onHideStartComposer}
                    isPending={startSessionPending}
                    error={startSessionError}
                  />
                ) : activeSession ? (
                  <SessionView session={activeSession} />
                ) : (
                  <div className="flex items-center justify-center h-full text-dim text-sm">
                    Select or start a session
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <>
            {task.worktreePath && <OpenInEditorButton worktreePath={task.worktreePath} />}
            <button
              onClick={handleBackToProgress}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              <ArrowLeft size={12} />
              Back to WIP
            </button>
            <button
              onClick={handleMarkDone}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 bg-accent text-white rounded-md font-medium text-xs hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Check size={12} />
              Done
            </button>
          </>
        }
      />

      {warning && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
          <span>{warning}</span>
          <button onClick={() => setWarning(null)} className="ml-4 hover:text-[var(--color-text-primary)] transition-colors">Dismiss</button>
        </div>
      )}

      <TaskGitMetaBar
        task={task}
        gitStatus={gitStatus}
        onCreatePr={handleCreatePR}
        createPrPending={createPR.isPending}
      />

      {/* Main content: diff + optional session panel below */}
      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
        {/* Diff area */}
        <div style={shouldShowPanel ? { height: `${splitPct}%` } : undefined} className={`${shouldShowPanel ? '' : 'flex-1'} flex overflow-hidden`}>
          <BaseDiffExplorer taskId={task.id} onFileCountChange={setDiffFileCount} />
        </div>

        {/* Session panel toggle / divider */}
        {shouldShowPanel ? (
          <>
            <div
              onMouseDown={onDividerDown}
              className="h-1 shrink-0 cursor-row-resize border-y border-subtle hover:bg-accent/40 transition-colors"
            />
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <SessionTabs
                sessions={sessions}
                activeSessionId={showComposer ? undefined : activeSession?.id}
                onSelect={(session) => {
                  onHideStartComposer();
                  onSelectSession(session);
                }}
                onResume={(session) => {
                  onHideStartComposer();
                  onStartSession('claude', '', session.id);
                }}
                onClose={onCloseSession}
                onNewSession={onShowStartComposer}
                showNewSessionTab={showComposer}
                onCancelNewSession={onHideStartComposer}
              />
              <div className="flex-1 overflow-hidden">
                {showComposer ? (
                  <NewSessionComposer
                    taskTitle={task.title}
                    taskDescription={task.description}
                    onStart={(provider, prompt) => onStartSession(provider, prompt)}
                    onCancel={onHideStartComposer}
                    isPending={startSessionPending}
                    error={startSessionError}
                  />
                ) : activeSession ? (
                  <SessionView session={activeSession} />
                ) : (
                  <div className="flex items-center justify-center h-full text-dim text-sm">
                    Select or start a session
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Collapsed: thin bar to open sessions */
          <button
            onClick={() => { setSessionPanelOpen(true); onShowStartComposer(); }}
            className="flex items-center justify-center gap-1.5 px-4 py-1.5 border-t border-subtle bg-secondary text-xs text-dim hover:text-accent hover:bg-tertiary transition-colors"
          >
            <Plus size={12} />
            Session
          </button>
        )}
      </div>
    </div>
  );
}
