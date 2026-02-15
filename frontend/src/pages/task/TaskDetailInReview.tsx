import { useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { TaskHeader } from './TaskHeader';
import { TaskGitMetaBar } from './TaskGitMetaBar';
import { NewSessionComposer, SessionView, SessionTabs } from '../../components/session';
import { BaseDiffExplorer } from '../../components/git';
import { tasksApi, invalidateTaskQueries, gitApi } from '../../api';
import { TASK_STATUS } from '../../api';
import type { Task, Project, AgentSession, SessionProvider, SessionType, UpdateTaskResponse } from '../../api';
import { OpenInEditorButton } from '../../components/common/OpenInEditorButton';
import { ActionToast } from '../../components/ui/ActionToast';
import { useMobile } from '../../hooks/useMobile';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

interface Props {
  task: Task;
  project?: Project;
  sessions: AgentSession[];
  activeSession: AgentSession | null;
  onSelectSession: (session: AgentSession) => void;
  onStartSession: (provider: SessionProvider, prompt: string, sessionType?: SessionType, resumeSessionId?: string) => Promise<AgentSession | void>;
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
  const [toast, setToast] = useState<{ type: 'warning' | 'error'; message: string } | null>(null);
  const [showDoneConfirm, setShowDoneConfirm] = useState(false);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const showComposer = showStartComposer || sessions.length === 0;
  const composerDismissible = showStartComposer;
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
        setToast({ type: 'warning', message: data.worktreeWarning.join('; ') });
      }
      if (data.workflowError) {
        setToast((prev) => ({
          type: 'warning',
          message: prev ? `${prev.message}; ${data.workflowError}` : data.workflowError!,
        }));
      }
    },
    onError: (error) => {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update task' });
    },
  });

  const createPR = useMutation({
    mutationFn: () => tasksApi.createPR(task.id),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
    onError: (err: Error) => setToast({ type: 'error', message: err.message }),
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
    setShowDoneConfirm(false);
    updateTask.mutate({ status: TASK_STATUS.DONE });
  };

  const handleCreatePR = () => {
    createPR.mutate();
  };

  const feedbackToast = (
    <ActionToast
      toast={toast}
      title={toast?.type === 'error' ? 'Task Update Failed' : 'Task Update Warning'}
      onDismiss={() => setToast(null)}
    />
  );

  // Count active sessions (running or waiting_input)
  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'waiting_input');
  const isSessionPanelOpen = sessions.length === 0 || sessionPanelOpen;

  // Auto-open panel when there are active sessions
  const shouldShowPanel = showComposer || isSessionPanelOpen || activeSessions.length > 0;

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <TaskHeader
          task={task}
          project={project}
          actions={
            <>
              {task.worktreePath && <OpenInEditorButton worktreePath={task.worktreePath} />}
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft size={12} />}
                onClick={handleBackToProgress}
                disabled={updateTask.isPending}
              >
                Back to WIP
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Check size={12} />}
                onClick={() => setShowDoneConfirm(true)}
                disabled={updateTask.isPending}
                loading={updateTask.isPending}
              >
                Done
              </Button>
            </>
          }
        />

        {feedbackToast}

        <TaskGitMetaBar
          task={task}
          onCreatePr={handleCreatePR}
          createPrPending={createPR.isPending}
          createPrPendingLabel="Creating..."
          prLinkClassName="text-accent hover:underline font-mono truncate text-[11px]"
        />

        {/* Mobile: tab between diff and sessions */}
        <div className="flex items-center border-b border-subtle bg-primary">
          <button
            onClick={() => setSessionPanelOpen(false)}
            className={`px-4 py-2 text-xs transition-colors ${!isSessionPanelOpen ? 'text-accent border-b-2 border-accent' : 'text-dim'}`}
          >
            Diff {diffFileCount > 0 && `(${diffFileCount})`}
          </button>
          <button
            onClick={() => setSessionPanelOpen(true)}
            className={`px-4 py-2 text-xs transition-colors ${isSessionPanelOpen ? 'text-accent border-b-2 border-accent' : 'text-dim'}`}
          >
            Sessions {activeSessions.length > 0 && `(${activeSessions.length})`}
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {!isSessionPanelOpen ? (
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
                  void onStartSession(session.provider, '', session.sessionType, session.id)
                    .then((resumed) => {
                      if (resumed) onSelectSession(resumed);
                      onCloseSession(session);
                    });
                }}
                onClose={onCloseSession}
                onNewSession={() => {
                  setSessionPanelOpen(true);
                  onShowStartComposer();
                }}
                showNewSessionTab={showComposer}
                onCancelNewSession={showStartComposer ? onHideStartComposer : undefined}
                showNewButton={!showComposer || sessions.length > 0}
              />
              <div className="flex-1 overflow-hidden">
                {showComposer ? (
                  <NewSessionComposer
                    taskTitle={task.title}
                    taskDescription={task.description}
                    onStart={(provider, prompt, sessionType) => { void onStartSession(provider, prompt, sessionType); }}
                    onCancel={onHideStartComposer}
                    isPending={startSessionPending}
                    error={startSessionError}
                    dismissible={composerDismissible}
                  />
                ) : activeSession ? (
                  <SessionView
                    session={activeSession}
                    onResume={activeSession.sessionType === 'chat' && activeSession.status === 'completed'
                      ? async () => {
                        const resumed = await onStartSession(activeSession.provider, '', activeSession.sessionType, activeSession.id);
                        if (resumed) onSelectSession(resumed);
                        onCloseSession(activeSession);
                      }
                      : undefined}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-dim text-sm">
                    Select or start a session
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <Modal
          open={showDoneConfirm}
          onClose={() => setShowDoneConfirm(false)}
          title="Move task to Done?"
          size="sm"
          footer={(
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDoneConfirm(false)}
                disabled={updateTask.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleMarkDone}
                loading={updateTask.isPending}
                disabled={updateTask.isPending}
              >
                Confirm
              </Button>
            </div>
          )}
        >
          <div className="px-5 py-3 space-y-2">
            <p className="text-sm text-dim">
              This will run the <span className="font-medium text-[var(--color-text-primary)]">In Review to Done</span> workflow before completing the status change.
            </p>
            <p className="text-xs text-dim">
              Action: <span className="font-mono">{project?.workflow?.reviewToDone?.action ?? 'nothing'}</span>
            </p>
            {updateTask.isError && (
              <p className="text-xs text-[var(--color-error)]">
                {updateTask.error instanceof Error ? updateTask.error.message : 'Failed to move task to done'}
              </p>
            )}
          </div>
        </Modal>
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
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft size={12} />}
              onClick={handleBackToProgress}
              disabled={updateTask.isPending}
            >
              Back to WIP
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Check size={12} />}
              onClick={() => setShowDoneConfirm(true)}
              disabled={updateTask.isPending}
              loading={updateTask.isPending}
            >
              Done
            </Button>
          </>
        }
      />

      {feedbackToast}

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
                  void onStartSession(session.provider, '', session.sessionType, session.id)
                    .then((resumed) => {
                      if (resumed) onSelectSession(resumed);
                      onCloseSession(session);
                    });
                }}
                onClose={onCloseSession}
                onNewSession={onShowStartComposer}
                showNewSessionTab={showComposer}
                onCancelNewSession={showStartComposer ? onHideStartComposer : undefined}
                showNewButton={!showComposer || sessions.length > 0}
              />
              <div className="flex-1 overflow-hidden">
                {showComposer ? (
                  <NewSessionComposer
                    taskTitle={task.title}
                    taskDescription={task.description}
                    onStart={(provider, prompt, sessionType) => { void onStartSession(provider, prompt, sessionType); }}
                    onCancel={onHideStartComposer}
                    isPending={startSessionPending}
                    error={startSessionError}
                    dismissible={composerDismissible}
                  />
                ) : activeSession ? (
                  <SessionView
                    session={activeSession}
                    onResume={activeSession.sessionType === 'chat' && activeSession.status === 'completed'
                      ? async () => {
                        const resumed = await onStartSession(activeSession.provider, '', activeSession.sessionType, activeSession.id);
                        if (resumed) onSelectSession(resumed);
                        onCloseSession(activeSession);
                      }
                      : undefined}
                  />
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
            className="flex items-center justify-center gap-1.5 mx-3 my-2 px-3 py-1.5 rounded-lg border border-subtle bg-[var(--color-card)] text-xs text-dim hover:text-accent hover:bg-tertiary transition-colors"
          >
            <Plus size={12} />
            Session
          </button>
        )}
      </div>

      <Modal
        open={showDoneConfirm}
        onClose={() => setShowDoneConfirm(false)}
        title="Move task to Done?"
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDoneConfirm(false)}
              disabled={updateTask.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleMarkDone}
              loading={updateTask.isPending}
              disabled={updateTask.isPending}
            >
              Confirm
            </Button>
          </div>
        )}
      >
        <div className="px-5 py-3 space-y-2">
          <p className="text-sm text-dim">
            This will run the <span className="font-medium text-[var(--color-text-primary)]">In Review to Done</span> workflow before completing the status change.
          </p>
          <p className="text-xs text-dim">
            Action: <span className="font-mono">{project?.workflow?.reviewToDone?.action ?? 'nothing'}</span>
          </p>
          {updateTask.isError && (
            <p className="text-xs text-[var(--color-error)]">
              {updateTask.error instanceof Error ? updateTask.error.message : 'Failed to move task to done'}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
