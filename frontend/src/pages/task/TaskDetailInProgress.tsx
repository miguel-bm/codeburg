import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { NewSessionComposer, SessionView, SessionTabs } from '../../components/session';
import { GitPanel } from '../../components/git';
import { DiffView } from '../../components/git';
import { ToolsPanel } from '../../components/tools';
import { tasksApi, invalidateTaskQueries, gitApi } from '../../api';
import { TASK_STATUS } from '../../api';
import type { Task, Project, AgentSession, SessionProvider, UpdateTaskResponse } from '../../api';
import { OpenInEditorButton } from '../../components/common/OpenInEditorButton';
import { useMobile } from '../../hooks/useMobile';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

type MainContent =
  | { type: 'session' }
  | { type: 'new_session' }
  | { type: 'diff'; file?: string; staged?: boolean; base?: boolean };

type MobilePanel = 'sessions' | 'git' | 'tools';

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

/** Reusable drag hook — tracks a pixel value from mousedown→mousemove→mouseup. */
function useDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  axis: 'x' | 'y',
  initial: number,
  clampMin: number,
  clampMax: number,
) {
  const [value, setValue] = useState(initial);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const px = axis === 'y'
        ? ev.clientY - rect.top
        : ev.clientX - rect.left;
      const total = axis === 'y' ? rect.height : rect.width;
      const clamped = Math.max(clampMin, Math.min(clampMax, px / total * 100));
      setValue(clamped);
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
  }, [containerRef, axis, clampMin, clampMax]);

  return [value, onMouseDown] as const;
}

export function TaskDetailInProgress({
  task, project, sessions, activeSession,
  onSelectSession, onStartSession, onCloseSession,
  onShowStartComposer, onHideStartComposer, showStartComposer,
  startSessionPending, startSessionError,
}: Props) {
  const queryClient = useQueryClient();
  const isMobile = useMobile();
  const [mainContent, setMainContent] = useState<MainContent>({ type: 'session' });
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('sessions');
  const [warning, setWarning] = useState<string | null>(null);
  const [dirtyConfirm, setDirtyConfirm] = useState<{ staged: number; unstaged: number; untracked: number } | null>(null);
  const showComposer = showStartComposer || sessions.length === 0;

  // Refs for drag containers
  const railRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Vertical split: git panel vs tools panel (percentage of rail height)
  const [gitPanelPct, onVDividerDown] = useDrag(railRef, 'y', 60, 20, 80);
  // Horizontal split: left rail vs main area (percentage of body width)
  const [railWidthPct, onHDividerDown] = useDrag(bodyRef, 'x', 22, 12, 50);

  useEffect(() => {
    setMainContent((prev) => {
      if (showStartComposer) return { type: 'new_session' };
      if (prev.type === 'new_session') return { type: 'session' };
      return prev;
    });
  }, [showStartComposer]);

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

  const doMoveToReview = () => {
    setDirtyConfirm(null);
    updateTask.mutate({ status: TASK_STATUS.IN_REVIEW });
  };

  const handleMoveToReview = async () => {
    try {
      const status = await gitApi.status(task.id);
      const dirty = status.staged.length + status.unstaged.length + status.untracked.length;
      if (dirty > 0) {
        setDirtyConfirm({
          staged: status.staged.length,
          unstaged: status.unstaged.length,
          untracked: status.untracked.length,
        });
        return;
      }
    } catch {
      // If git status fails (e.g. no worktree), proceed anyway
    }
    doMoveToReview();
  };

  const handleFileClick = (file?: string, staged?: boolean, base?: boolean) => {
    setMainContent((prev) => {
      if (prev.type === 'diff' && prev.file === file && prev.staged === staged && prev.base === base) {
        return { type: 'session' };
      }
      return { type: 'diff', file, staged, base };
    });
  };

  const handleRecipeRun = (command: string) => {
    const persistentCommand = `{ ${command}; __cb_exit=$?; echo; echo "[codeburg] Recipe exited with code $__cb_exit. Terminal kept open."; exec "\${SHELL:-/bin/bash}" -il; }`;
    onStartSession('terminal', persistentCommand);
  };

  const warningBanner = warning && (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
      <span>{warning}</span>
      <button onClick={() => setWarning(null)} className="ml-4 hover:text-[var(--color-text-primary)] transition-colors">
        Dismiss
      </button>
    </div>
  );

  const dirtyModal = (
    <Modal
      open={!!dirtyConfirm}
      onClose={() => setDirtyConfirm(null)}
      title="Uncommitted changes"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDirtyConfirm(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={doMoveToReview}>
            Move anyway
          </Button>
        </div>
      }
    >
      <div className="px-5 py-3">
        <p className="text-xs text-dim mb-3">
          This worktree has uncommitted changes that will not be included in the review:
        </p>
        {dirtyConfirm && (
          <ul className="text-xs text-dim space-y-1">
            {dirtyConfirm.staged > 0 && <li>{dirtyConfirm.staged} staged file{dirtyConfirm.staged !== 1 ? 's' : ''}</li>}
            {dirtyConfirm.unstaged > 0 && <li>{dirtyConfirm.unstaged} unstaged file{dirtyConfirm.unstaged !== 1 ? 's' : ''}</li>}
            {dirtyConfirm.untracked > 0 && <li>{dirtyConfirm.untracked} untracked file{dirtyConfirm.untracked !== 1 ? 's' : ''}</li>}
          </ul>
        )}
      </div>
    </Modal>
  );

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
                variant="primary"
                size="sm"
                onClick={handleMoveToReview}
                disabled={updateTask.isPending}
              >
                review
              </Button>
            </>
          }
        />
        {warningBanner}
        {dirtyModal}

        {/* Panel selector + session selector */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-subtle bg-primary">
          <select
            value={mobilePanel}
            onChange={(e) => setMobilePanel(e.target.value as MobilePanel)}
            className="bg-primary border border-subtle rounded-md text-sm px-2 py-1 focus:outline-none focus:border-[var(--color-text-secondary)]"
          >
            <option value="sessions">Sessions</option>
            <option value="git">Git</option>
            <option value="tools">Tools</option>
          </select>
          {mobilePanel === 'sessions' && sessions.length > 0 && (
            <select
              value={activeSession?.id || ''}
              onChange={(e) => {
                const s = sessions.find(s => s.id === e.target.value);
                if (s) {
                  onHideStartComposer();
                  onSelectSession(s);
                }
              }}
              className="bg-primary border border-subtle text-sm px-2 py-1 focus:outline-none focus:border-accent flex-1 min-w-0"
            >
              <option value="">Select session...</option>
              {[...sessions]
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((s, i) => (
                  <option key={s.id} value={s.id}>
                    #{i + 1} {s.provider} [{s.status}]
                  </option>
                ))}
            </select>
          )}
          {mobilePanel === 'sessions' && (
            <button
              onClick={onShowStartComposer}
              className="text-xs text-accent hover:underline shrink-0"
            >
              + New
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {mobilePanel === 'sessions' ? (
            showComposer ? (
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
            )
          ) : mobilePanel === 'git' ? (
            <div className="overflow-y-auto h-full">
              <GitPanel
                taskId={task.id}
                onFileClick={handleFileClick}
                selectedFile={mainContent.type === 'diff' ? mainContent.file : undefined}
                selectedStaged={mainContent.type === 'diff' ? mainContent.staged : undefined}
                selectedBase={mainContent.type === 'diff' ? mainContent.base : undefined}
                scrollable={false}
              />
              {mainContent.type === 'diff' && (
                <div className="border-t border-subtle">
                  <DiffView
                    taskId={task.id}
                    file={mainContent.file}
                    staged={mainContent.staged}
                    base={mainContent.base}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-y-auto h-full">
              <ToolsPanel taskId={task.id} onRecipeRun={handleRecipeRun} />
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
            <Button
              variant="primary"
              size="sm"
              onClick={handleMoveToReview}
              disabled={updateTask.isPending}
            >
              Review
            </Button>
          </>
        }
      />
      {warningBanner}
      {dirtyModal}

      <div ref={bodyRef} className="flex-1 flex overflow-hidden">
        {/* Left rail */}
        <div
          ref={railRef}
          style={{ width: `${railWidthPct}%` }}
          className="shrink-0 flex flex-col overflow-hidden"
        >
          {/* Git panel */}
          <div style={{ height: `${gitPanelPct}%` }} className="overflow-hidden min-h-0">
            <GitPanel
              taskId={task.id}
              onFileClick={handleFileClick}
              selectedFile={mainContent.type === 'diff' ? mainContent.file : undefined}
              selectedStaged={mainContent.type === 'diff' ? mainContent.staged : undefined}
              selectedBase={mainContent.type === 'diff' ? mainContent.base : undefined}
            />
          </div>
          {/* Vertical divider (git ↔ tools) */}
          <div
            onMouseDown={onVDividerDown}
            className="h-1 shrink-0 cursor-row-resize border-y border-subtle hover:bg-accent/40 transition-colors"
          />
          {/* Tools panel */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <ToolsPanel taskId={task.id} onRecipeRun={handleRecipeRun} />
          </div>
        </div>

        {/* Horizontal divider (rail ↔ main) */}
        <div
          onMouseDown={onHDividerDown}
          className="w-1 shrink-0 cursor-col-resize border-x border-subtle hover:bg-accent/40 transition-colors"
        />

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Session tabs */}
          <SessionTabs
            sessions={sessions}
            activeSessionId={showComposer
              ? undefined
              : (mainContent.type === 'session' ? activeSession?.id : undefined)}
            onSelect={(session) => {
              onSelectSession(session);
              onHideStartComposer();
              setMainContent({ type: 'session' });
            }}
            onResume={(session) => {
              onHideStartComposer();
              onStartSession('claude', '', session.id);
            }}
            onClose={onCloseSession}
            onNewSession={onShowStartComposer}
            showNewSessionTab={showComposer}
            onCancelNewSession={showStartComposer ? onHideStartComposer : undefined}
          />

          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            {showComposer || mainContent.type === 'new_session' ? (
              <NewSessionComposer
                taskTitle={task.title}
                taskDescription={task.description}
                onStart={(provider, prompt) => onStartSession(provider, prompt)}
                onCancel={onHideStartComposer}
                isPending={startSessionPending}
                error={startSessionError}
              />
            ) : mainContent.type === 'session' ? (
              activeSession ? (
                <SessionView session={activeSession} />
              ) : (
                <div className="flex items-center justify-center h-full text-dim text-sm">
                  Select or start a session
                </div>
              )
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-primary">
                  <span className="text-xs font-mono text-dim">
                    {mainContent.file || 'full branch diff'}
                    {mainContent.base
                      ? ` (vs ${project?.defaultBranch || 'main'})`
                      : (mainContent.staged ? ' (staged)' : '')}
                  </span>
                  <button
                    onClick={() => setMainContent({ type: 'session' })}
                    className="text-xs text-dim hover:text-accent"
                  >
                    Back to session
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <DiffView
                    taskId={task.id}
                    file={mainContent.file}
                    staged={mainContent.staged}
                    base={mainContent.base}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
