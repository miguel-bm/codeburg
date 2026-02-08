import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { SessionView, SessionTabs } from '../../components/session';
import { GitPanel } from '../../components/git';
import { DiffView } from '../../components/git';
import { ToolsPanel } from '../../components/tools';
import { tasksApi } from '../../api';
import type { Task, Project, AgentSession, SessionProvider } from '../../api';
import { useMobile } from '../../hooks/useMobile';

type MainContent =
  | { type: 'session' }
  | { type: 'diff'; file?: string; staged?: boolean };

type MobilePanel = 'sessions' | 'git' | 'tools';

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

export function TaskDetailInProgress({
  task, project, sessions, activeSession,
  onSelectSession, onStartSession, onCloseSession,
  onShowStartModal,
}: Props) {
  const queryClient = useQueryClient();
  const isMobile = useMobile();
  const [mainContent, setMainContent] = useState<MainContent>({ type: 'session' });
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('sessions');
  const [gitPanelPct, setGitPanelPct] = useState(60);
  const railRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    },
  });

  const handleMoveToReview = () => {
    updateTask.mutate({ status: 'in_review' });
  };

  const handleFileClick = (file: string, staged: boolean) => {
    setMainContent({ type: 'diff', file, staged });
  };

  const handleRecipeRun = (command: string) => {
    onStartSession('terminal', command);
  };

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !railRef.current) return;
      const rect = railRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setGitPanelPct(Math.max(20, Math.min(80, pct)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <TaskHeader
          task={task}
          project={project}
          actions={
            <button
              onClick={handleMoveToReview}
              disabled={updateTask.isPending}
              className="px-3 py-1.5 border border-accent text-accent text-xs hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              review
            </button>
          }
        />

        {/* Panel selector + session selector */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-subtle bg-secondary">
          <select
            value={mobilePanel}
            onChange={(e) => setMobilePanel(e.target.value as MobilePanel)}
            className="bg-primary border border-subtle text-sm px-2 py-1 focus:outline-none focus:border-accent"
          >
            <option value="sessions">sessions</option>
            <option value="git">git</option>
            <option value="tools">tools</option>
          </select>
          {mobilePanel === 'sessions' && sessions.length > 0 && (
            <select
              value={activeSession?.id || ''}
              onChange={(e) => {
                const s = sessions.find(s => s.id === e.target.value);
                if (s) onSelectSession(s);
              }}
              className="bg-primary border border-subtle text-sm px-2 py-1 focus:outline-none focus:border-accent flex-1 min-w-0"
            >
              <option value="">select session...</option>
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
              onClick={onShowStartModal}
              className="text-xs text-accent hover:underline shrink-0"
            >
              + new
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {mobilePanel === 'sessions' ? (
            activeSession ? (
              <SessionView session={activeSession} />
            ) : (
              <div className="flex items-center justify-center h-full text-dim text-sm">
                select or start a session
              </div>
            )
          ) : mobilePanel === 'git' ? (
            <div className="overflow-y-auto h-full">
              <GitPanel taskId={task.id} onFileClick={handleFileClick} />
              {mainContent.type === 'diff' && (
                <div className="border-t border-subtle">
                  <DiffView
                    taskId={task.id}
                    file={mainContent.file}
                    staged={mainContent.staged}
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
          <button
            onClick={handleMoveToReview}
            disabled={updateTask.isPending}
            className="px-3 py-1.5 border border-accent text-accent text-xs hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
          >
            review
          </button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left rail */}
        <div ref={railRef} className="w-[280px] shrink-0 border-r border-subtle flex flex-col overflow-hidden">
          <div style={{ height: `${gitPanelPct}%` }} className="overflow-y-auto shrink-0">
            <GitPanel taskId={task.id} onFileClick={handleFileClick} />
          </div>
          <div
            onMouseDown={handleDividerMouseDown}
            className="h-1 shrink-0 cursor-row-resize bg-subtle hover:bg-accent transition-colors"
          />
          <div className="flex-1 overflow-y-auto min-h-0">
            <ToolsPanel taskId={task.id} onRecipeRun={handleRecipeRun} />
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Session tabs */}
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

          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            {mainContent.type === 'session' ? (
              activeSession ? (
                <SessionView session={activeSession} />
              ) : (
                <div className="flex items-center justify-center h-full text-dim text-sm">
                  select or start a session
                </div>
              )
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-secondary">
                  <span className="text-xs font-mono text-dim">
                    {mainContent.file || 'full branch diff'}
                    {mainContent.staged && ' (staged)'}
                  </span>
                  <button
                    onClick={() => setMainContent({ type: 'session' })}
                    className="text-xs text-dim hover:text-accent"
                  >
                    back to session
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <DiffView
                    taskId={task.id}
                    file={mainContent.file}
                    staged={mainContent.staged}
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
