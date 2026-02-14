import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Pin, Settings, GitPullRequest, GitBranch, Funnel, Plus, Eye, EyeOff } from 'lucide-react';
import { tasksApi, projectsApi, preferencesApi, invalidateTaskQueries, TASK_STATUS } from '../../api';
import type { SidebarProject, SidebarTask, SidebarSession, SidebarData } from '../../api';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { getSessionStatusMeta } from '../../lib/sessionStatus';

// --- Project Node ---

interface SidebarProjectNodeProps {
  project: SidebarProject;
  isActive: boolean;
  isFiltered: boolean;
  activeTaskId?: string;
  activeSessionId?: string;
  onProjectClick: (id: string) => void;
  onProjectFilterClick: (id: string, isFiltered: boolean) => void;
  onClose?: () => void;
  collapseSignal: number;
  forceCollapsed: boolean;
  onCollapseToggle?: () => void;
  keyboardFocused?: boolean;
  focusedTaskId?: string;
  addTaskFocused?: boolean;
  onOpenWizard: () => void;
  mobile?: boolean;
}

export function SidebarProjectNode({ project, isActive, isFiltered, activeTaskId, activeSessionId, onProjectClick, onProjectFilterClick, onClose, collapseSignal, forceCollapsed, onCollapseToggle, keyboardFocused, focusedTaskId, addTaskFocused, onOpenWizard, mobile }: SidebarProjectNodeProps) {
  const { navigateToPanel } = usePanelNavigation();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(`sidebar-collapse-${project.id}`);
    return stored === 'true';
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      const sidebar = queryClient.getQueryData<SidebarData>(['sidebar']);
      const currentPinned = sidebar?.projects.filter((p) => p.pinned).map((p) => p.id) ?? [];
      const nextPinned = project.pinned
        ? currentPinned.filter((id) => id !== project.id)
        : [...currentPinned, project.id];
      return preferencesApi.setPinnedProjects(nextPinned);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    },
  });

  // Respond to collapse-all / expand-all signals
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (collapseSignal > 0) {
      timer = setTimeout(() => setCollapsed(forceCollapsed), 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [collapseSignal, forceCollapsed]);

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(`sidebar-collapse-${project.id}`, String(next));
    onCollapseToggle?.();
  };

  // Flat list: in_review first, then in_progress (each group keeps kanban order)
  const sortedTasks = [
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW),
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS),
  ];
  const hasTasks = sortedTasks.length > 0;

  return (
    <div>
      {/* Project header */}
      <div
        data-sidebar-project={project.id}
        onClick={() => onProjectClick(project.id)}
        className={`flex items-center gap-2 px-2 mx-2 my-0.5 cursor-pointer hover:bg-tertiary rounded-md transition-colors group ${mobile ? 'py-2 text-base' : 'py-1 text-sm'} ${isActive ? 'bg-tertiary' : ''} ${keyboardFocused ? 'bg-accent/10' : ''}`}
      >
        {hasTasks ? (
          <button
            onClick={toggleCollapse}
            aria-label={collapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
            className="h-6 w-6 flex items-center justify-center -ml-1 rounded text-dim hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 transition-colors flex-shrink-0"
          >
            <ChevronRight size={12} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          </button>
        ) : (
          <div className="w-6 flex-shrink-0" />
        )}
        <span className={`truncate ${isActive ? 'text-accent' : 'text-[var(--color-text-primary)]'}`}>
          {project.name}
        </span>
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); pinMutation.mutate(); }}
            className={`transition-colors ${
              project.pinned
                ? 'text-accent hover:text-[var(--color-text-primary)]'
                : 'text-transparent group-hover:text-dim hover:!text-accent'
            }`}
            title={project.pinned ? 'unpin project' : 'pin project'}
          >
            <Pin size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onProjectFilterClick(project.id, isFiltered); }}
            className={`transition-colors ${
              isFiltered
                ? 'text-accent hover:text-[var(--color-text-primary)]'
                : 'text-transparent group-hover:text-dim hover:!text-accent'
            }`}
            title={isFiltered ? 'clear project filter' : 'filter dashboard by project'}
          >
            <Funnel size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigateToPanel(`/projects/${project.id}/settings`); onClose?.(); }}
            className="text-transparent group-hover:text-dim hover:!text-accent transition-colors"
            title="project settings"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {/* Tasks (when expanded) */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="tasks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-1">
              {project.sessions.map((session) => (
                <SidebarSessionNode
                  key={session.id}
                  session={session}
                  projectId={project.id}
                  isActive={activeSessionId === session.id}
                  onClose={onClose}
                  mobile={mobile}
                />
              ))}
              {sortedTasks.map((task) => (
                <SidebarTaskNode key={task.id} task={task} onClose={onClose} keyboardFocused={focusedTaskId === task.id} mobile={mobile} isActive={activeTaskId === task.id} activeSessionId={activeSessionId} />
              ))}
              <AddTaskButton projectId={project.id} onOpenWizard={onOpenWizard} keyboardFocused={addTaskFocused} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Hidden Projects Section ---

interface HiddenProjectsSectionProps {
  projects: SidebarProject[];
  expanded: boolean;
  onToggle: () => void;
  onProjectClick: (id: string) => void;
  activeProjectPageId?: string;
}

export function HiddenProjectsSection({ projects, expanded, onToggle, onProjectClick, activeProjectPageId }: HiddenProjectsSectionProps) {
  const queryClient = useQueryClient();

  const unhideMutation = useMutation({
    mutationFn: (id: string) => projectsApi.update(id, { hidden: false }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
    },
  });

  return (
    <div>
      {/* Narrow divider */}
      <div className="mx-5 border-t border-subtle" />

      {/* Expanded list — above toggle so it grows upward */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {projects.map((project) => (
              <div
                key={project.id}
                className={`flex items-center gap-2 px-3 py-1.5 mx-1 text-xs rounded-md group ${
                  activeProjectPageId === project.id ? 'bg-tertiary' : 'hover:bg-tertiary'
                }`}
              >
                <span
                  className="truncate flex-1 text-dim cursor-pointer hover:text-[var(--color-text-secondary)]"
                  onClick={() => onProjectClick(project.id)}
                >
                  {project.name}
                </span>
                <button
                  onClick={() => unhideMutation.mutate(project.id)}
                  className="flex-shrink-0 text-transparent group-hover:text-dim hover:!text-accent transition-colors"
                  title="Unhide project"
                >
                  <Eye size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button — always at bottom */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-dim hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <EyeOff size={12} />
        <span>Hidden ({projects.length})</span>
        <ChevronRight size={10} className={`ml-auto transition-transform ${expanded ? '-rotate-90' : 'rotate-90'}`} />
      </button>
    </div>
  );
}

// --- Add Task Button ---

interface AddTaskButtonProps {
  projectId: string;
  onOpenWizard: () => void;
  keyboardFocused?: boolean;
}

function AddTaskButton({ projectId, onOpenWizard, keyboardFocused }: AddTaskButtonProps) {
  return (
    <div
      data-sidebar-add-task={`add-${projectId}`}
      onClick={onOpenWizard}
      className={`flex items-center gap-1.5 px-6 py-1 mx-2 text-xs cursor-pointer hover:bg-tertiary rounded-md transition-colors ${keyboardFocused ? 'bg-accent/10' : ''}`}
    >
      <Plus size={12} className="flex-shrink-0 text-dim" />
      <span className="text-dim hover:text-accent transition-colors">New task</span>
    </div>
  );
}

// --- Task Node ---

interface SidebarTaskNodeProps {
  task: SidebarTask;
  onClose?: () => void;
  keyboardFocused?: boolean;
  mobile?: boolean;
  isActive?: boolean;
  activeSessionId?: string;
}

function SidebarTaskNode({ task, onClose, keyboardFocused, mobile, isActive, activeSessionId }: SidebarTaskNodeProps) {
  const { navigateToPanel } = usePanelNavigation();
  const queryClient = useQueryClient();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = () => {
    navigateToPanel(`/tasks/${task.id}`);
    onClose?.();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const updateMutation = useMutation({
    mutationFn: (data: { status?: string }) =>
      tasksApi.update(task.id, data as Parameters<typeof tasksApi.update>[1]),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
  });

  const { copied: branchCopied, copy: copyBranch } = useCopyToClipboard();

  const handleCopyBranch = () => {
    if (task.branch) {
      copyBranch(task.branch);
    }
    setContextMenu(null);
  };

  const handleMoveToReview = () => {
    updateMutation.mutate({ status: TASK_STATUS.IN_REVIEW });
    setContextMenu(null);
  };

  const handleMoveToDone = () => {
    updateMutation.mutate({ status: TASK_STATUS.DONE });
    setContextMenu(null);
  };

  return (
    <div>
      <div
        data-sidebar-task={task.id}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`flex items-center gap-1.5 px-6 mx-2 cursor-pointer hover:bg-tertiary rounded-md transition-colors group ${mobile ? 'py-1.5 text-sm' : 'py-1 text-xs'} ${isActive ? 'bg-accent/15' : ''} ${keyboardFocused ? 'bg-accent/10' : ''}`}
      >
        <TaskStatusIcon status={task.status} />
        <span className={`truncate flex-1 ${isActive ? 'text-accent' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
          {task.title}
        </span>
        {branchCopied && (
          <span className="text-[10px] text-accent flex-shrink-0">copied!</span>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* PR link for in_review tasks */}
          {task.prUrl && task.status === TASK_STATUS.IN_REVIEW && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] text-[var(--color-status-in-review)] hover:text-accent"
              title="open PR"
            >
              PR
            </a>
          )}
          {task.diffStats && (task.diffStats.additions > 0 || task.diffStats.deletions > 0) && (
            <span className="text-[10px] font-mono">
              {task.diffStats.additions > 0 && (
                <span className="text-[var(--color-success)]">+{task.diffStats.additions}</span>
              )}
              {task.diffStats.additions > 0 && task.diffStats.deletions > 0 && ' '}
              {task.diffStats.deletions > 0 && (
                <span className="text-[var(--color-error)]">-{task.diffStats.deletions}</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Sessions under task */}
      {task.sessions.map((session) => (
        <SidebarSessionNode
          key={session.id}
          session={session}
          taskId={task.id}
          isActive={activeSessionId === session.id}
          onClose={onClose}
          mobile={mobile}
        />
      ))}

      {/* Context menu */}
      {contextMenu && (
        <TaskNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={task}
          onClose={() => setContextMenu(null)}
          onCopyBranch={handleCopyBranch}
          onMoveToReview={handleMoveToReview}
          onMoveToDone={handleMoveToDone}
          onOpenTask={handleClick}
        />
      )}
    </div>
  );
}

// --- Task Context Menu ---

interface TaskNodeContextMenuProps {
  x: number;
  y: number;
  task: SidebarTask;
  onClose: () => void;
  onCopyBranch: () => void;
  onMoveToReview: () => void;
  onMoveToDone: () => void;
  onOpenTask: () => void;
}

function TaskNodeContextMenu({ x, y, task, onClose, onCopyBranch, onMoveToReview, onMoveToDone, onOpenTask }: TaskNodeContextMenuProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const menuStyle = {
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - 200),
  };

  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        className="fixed z-[100] bg-elevated border border-subtle rounded-lg shadow-lg min-w-[160px]"
        style={menuStyle}
      >
        <button
          onClick={onOpenTask}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary rounded-md transition-colors"
        >
          Open Task
        </button>
        {task.branch && (
          <button
            onClick={onCopyBranch}
            className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary rounded-md transition-colors"
          >
            Copy Branch Name
          </button>
        )}
        {task.prUrl && (
          <button
            onClick={() => { window.open(task.prUrl!, '_blank'); onClose(); }}
            className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary rounded-md transition-colors"
          >
            Open PR
          </button>
        )}
        <div className="border-t border-subtle" />
        {task.status === TASK_STATUS.IN_PROGRESS && (
          <button
            onClick={onMoveToReview}
            className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary text-[var(--color-status-in-review)] transition-colors"
          >
            Move to Review
          </button>
        )}
        {task.status === TASK_STATUS.IN_REVIEW && (
          <button
            onClick={onMoveToDone}
            className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary text-[var(--color-status-done)] transition-colors"
          >
            Move to Done
          </button>
        )}
      </div>
    </>
  );
}

// --- Session Node ---

interface SidebarSessionNodeProps {
  session: SidebarSession;
  taskId?: string;
  projectId?: string;
  onClose?: () => void;
  mobile?: boolean;
  isActive?: boolean;
}

function SidebarSessionNode({ session, taskId, projectId, onClose, mobile, isActive }: SidebarSessionNodeProps) {
  const { navigateToPanel } = usePanelNavigation();

  const handleClick = () => {
    if (taskId) {
      navigateToPanel(`/tasks/${taskId}?session=${session.id}`);
    } else if (projectId) {
      navigateToPanel(`/projects/${projectId}?session=${session.id}`);
    }
    onClose?.();
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-2 pl-11 pr-3 mx-2 cursor-pointer hover:bg-tertiary rounded-md transition-colors ${mobile ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} ${isActive ? 'bg-accent/15' : ''}`}
    >
      <StatusDot status={session.status} />
      <span className={isActive ? 'text-accent' : 'text-dim'}>
        {session.provider} #{session.number}
      </span>
    </div>
  );
}

// --- Status Dot ---

function StatusDot({ status }: { status: SidebarSession['status'] }) {
  const { dotClass } = getSessionStatusMeta(status);
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />;
}

function getTaskStatusDotClass(status: SidebarTask['status']): string {
  if (status === TASK_STATUS.IN_REVIEW) return 'bg-[var(--color-status-in-review)]';
  if (status === TASK_STATUS.IN_PROGRESS) return 'bg-[var(--color-status-in-progress)]';
  return 'bg-[var(--color-text-dim)]';
}

export function CollapsedProjectIndicators({ project }: { project: SidebarProject }) {
  const sortedTasks = [
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW),
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS),
  ];
  const sessions = [
    ...project.sessions,
    ...sortedTasks.flatMap((task) => task.sessions),
  ];
  const visibleTasks = sortedTasks.slice(0, 4);
  const visibleSessions = sessions.slice(0, 4);

  if (visibleTasks.length === 0 && visibleSessions.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-0.5 mb-1 flex flex-col items-center gap-[2px]"
      title={`Tasks: ${sortedTasks.length} · Sessions: ${sessions.length}`}
    >
      <div className="h-1.5 flex items-center justify-center gap-[2px]">
        {visibleTasks.map((task) => (
          <span key={task.id} className={`w-1 h-1 rounded-full ${getTaskStatusDotClass(task.status)}`} />
        ))}
        {sortedTasks.length > visibleTasks.length && (
          <span className="text-[8px] text-dim leading-none">+</span>
        )}
      </div>
      <div className="h-1.5 flex items-center justify-center gap-[2px]">
        {visibleSessions.map((session) => {
          const { dotClass } = getSessionStatusMeta(session.status);
          return <span key={session.id} className={`w-1 h-1 rounded-full ${dotClass}`} />;
        })}
        {sessions.length > visibleSessions.length && (
          <span className="text-[8px] text-dim leading-none">+</span>
        )}
      </div>
    </div>
  );
}

// --- Status Icon (shown before each task name) ---

function TaskStatusIcon({ status }: { status: string }) {
  if (status === TASK_STATUS.IN_REVIEW) {
    return <GitPullRequest size={12} className="flex-shrink-0" style={{ color: 'var(--color-status-in-review)' }} />;
  }
  // Branch icon — green (in_progress)
  return <GitBranch size={12} className="flex-shrink-0" style={{ color: 'var(--color-status-in-progress)' }} />;
}
