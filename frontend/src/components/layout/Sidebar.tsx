import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronUp, X, Settings, ChevronRight, Pin, GitPullRequest, GitBranch, Funnel } from 'lucide-react';
import { sidebarApi, tasksApi, preferencesApi, invalidateTaskQueries, TASK_STATUS } from '../../api';
import type { SidebarProject, SidebarTask, SidebarSession, SidebarData, UpdateTaskResponse } from '../../api';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useSidebarFocusStore } from '../../stores/sidebarFocus';
import { CreateProjectModal } from '../common/CreateProjectModal';

interface FocusableItem {
  type: 'project' | 'task';
  id: string;
  projectId?: string;
}

interface SidebarProps {
  onClose?: () => void;
  width?: number;
}

function countWaiting(data: SidebarData | undefined): number {
  if (!data?.projects) return 0;
  let n = 0;
  for (const p of data.projects) {
    for (const t of p.tasks) {
      for (const s of t.sessions) {
        if (s.status === 'waiting_input') n++;
      }
    }
  }
  return n;
}

export function Sidebar({ onClose, width }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [showCreateProject, setShowCreateProject] = useState(false);

  const activeProjectId = searchParams.get('project') || undefined;
  const projectPageMatch = location.pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  const activeProjectPageId = projectPageMatch?.[1];

  const { data: sidebar, isLoading } = useQuery({
    queryKey: ['sidebar'],
    queryFn: sidebarApi.get,
    refetchInterval: 10000,
  });

  // Listen for sidebar_update WebSocket messages
  useWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type === 'sidebar_update') {
        queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      }
    }, [queryClient]),
  });

  const waitingCount = countWaiting(sidebar);

  const sidebarFocused = useSidebarFocusStore((s) => s.focused);
  const sidebarIndex = useSidebarFocusStore((s) => s.index);
  const sidebarExit = useSidebarFocusStore((s) => s.exit);
  const sidebarSetIndex = useSidebarFocusStore((s) => s.setIndex);

  // Collapse all / expand all
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapseSignal, setCollapseSignal] = useState(0); // incremented to signal children
  const [collapseVersion, setCollapseVersion] = useState(0); // incremented on individual project toggle

  const toggleCollapseAll = () => {
    const next = !allCollapsed;
    setAllCollapsed(next);
    // Persist all project collapse states
    if (sidebar?.projects) {
      for (const p of sidebar.projects) {
        localStorage.setItem(`sidebar-collapse-${p.id}`, String(next));
      }
    }
    setCollapseSignal((s) => s + 1);
  };

  const handleCollapseToggle = useCallback(() => {
    setCollapseVersion((v) => v + 1);
  }, []);

  // Build flat list of focusable sidebar items
  const focusableItems = useMemo((): FocusableItem[] => {
    if (!sidebar?.projects) return [];
    const items: FocusableItem[] = [];
    for (const p of sidebar.projects) {
      items.push({ type: 'project', id: p.id });
      const isCollapsed = localStorage.getItem(`sidebar-collapse-${p.id}`) === 'true';
      if (!isCollapsed) {
        const sortedTasks = [
          ...p.tasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW),
          ...p.tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS),
        ];
        for (const t of sortedTasks) {
          items.push({ type: 'task', id: t.id, projectId: p.id });
        }
      }
    }
    return items;
    // collapseVersion/collapseSignal included to recalculate when projects are toggled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebar, collapseVersion, collapseSignal]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll focused sidebar item into view
  useEffect(() => {
    if (!sidebarFocused || !scrollContainerRef.current) return;
    const item = focusableItems[sidebarIndex];
    if (!item) return;
    const attr = item.type === 'project' ? `data-sidebar-project="${item.id}"` : `data-sidebar-task="${item.id}"`;
    const el = scrollContainerRef.current.querySelector(`[${attr}]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [sidebarFocused, sidebarIndex, focusableItems]);

  // Keyboard navigation for sidebar (desktop only)
  useKeyboardNav({
    keyMap: {
      ArrowUp: () => sidebarSetIndex(Math.max(sidebarIndex - 1, 0)),
      k: () => sidebarSetIndex(Math.max(sidebarIndex - 1, 0)),
      ArrowDown: () => sidebarSetIndex(Math.min(sidebarIndex + 1, focusableItems.length - 1)),
      j: () => sidebarSetIndex(Math.min(sidebarIndex + 1, focusableItems.length - 1)),
      ArrowRight: () => sidebarExit(),
      l: () => sidebarExit(),
      Escape: () => sidebarExit(),
      Enter: () => {
        const item = focusableItems[sidebarIndex];
        if (!item) return;
        if (item.type === 'project') {
          navigate(`/projects/${item.id}`);
        } else {
          navigate(`/tasks/${item.id}`);
        }
      },
    },
    enabled: sidebarFocused && !onClose, // desktop only
  });

  const handleProjectClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
    onClose?.();
  };

  const handleProjectFilterClick = (projectId: string) => {
    navigate(`/?project=${projectId}`);
    onClose?.();
  };

  const handleHomeClick = () => {
    sessionStorage.removeItem('codeburg:active-project');
    navigate('/');
    onClose?.();
  };

  const handleSettingsClick = () => {
    navigate('/settings');
    onClose?.();
  };

  const sidebarStyle = width ? { width } : undefined;

  return (
    <aside
      className={`bg-secondary flex flex-col h-full ${width ? '' : 'w-72'}`}
      style={sidebarStyle}
    >
      {/* Header */}
      <div className="p-4 border-b border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1
            onClick={handleHomeClick}
            className="text-lg font-semibold text-[var(--color-text-primary)] hover:text-accent transition-colors cursor-pointer"
          >Codeburg</h1>
          {waitingCount > 0 && (
            <span className="text-xs bg-[var(--color-warning)]/15 text-[var(--color-warning)] animate-pulse font-medium rounded-full px-1.5 py-0.5">
              {waitingCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Collapse all / expand all */}
          {sidebar?.projects && sidebar.projects.length > 0 && (
            <button
              onClick={toggleCollapseAll}
              className="p-1 text-dim hover:text-[var(--color-text-secondary)] rounded-md transition-colors"
              title={allCollapsed ? 'expand all' : 'collapse all'}
            >
              {allCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:text-[var(--color-text-secondary)] rounded-md transition-colors"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable tree */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-tertiary w-24 mb-2" />
                <div className="h-3 bg-tertiary w-36 ml-3" />
              </div>
            ))}
          </div>
        ) : !sidebar?.projects?.length ? (
          <div className="px-4 py-6 text-sm text-dim text-center">
            No projects yet
          </div>
        ) : (
          sidebar.projects.map((project) => {
            const focusedItem = sidebarFocused ? focusableItems[sidebarIndex] : null;
            return (
              <SidebarProjectNode
                key={project.id}
                project={project}
                isActive={activeProjectPageId === project.id}
                isFiltered={location.pathname === '/' && activeProjectId === project.id}
                onProjectClick={handleProjectClick}
                onProjectFilterClick={handleProjectFilterClick}
                onClose={onClose}
                collapseSignal={collapseSignal}
                forceCollapsed={allCollapsed}
                onCollapseToggle={handleCollapseToggle}
                keyboardFocused={focusedItem?.type === 'project' && focusedItem.id === project.id}
                focusedTaskId={focusedItem?.type === 'task' && focusedItem.projectId === project.id ? focusedItem.id : undefined}
              />
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-subtle flex gap-2">
        <button
          onClick={() => setShowCreateProject(true)}
          className="flex-1 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
        >
          + Project
        </button>
        <button
          onClick={handleSettingsClick}
          className="px-3 py-2 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
          title="settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} />
      )}
    </aside>
  );
}

// --- Project Node ---

interface SidebarProjectNodeProps {
  project: SidebarProject;
  isActive: boolean;
  isFiltered: boolean;
  onProjectClick: (id: string) => void;
  onProjectFilterClick: (id: string) => void;
  onClose?: () => void;
  collapseSignal: number;
  forceCollapsed: boolean;
  onCollapseToggle?: () => void;
  keyboardFocused?: boolean;
  focusedTaskId?: string;
}

function SidebarProjectNode({ project, isActive, isFiltered, onProjectClick, onProjectFilterClick, onClose, collapseSignal, forceCollapsed, onCollapseToggle, keyboardFocused, focusedTaskId }: SidebarProjectNodeProps) {
  const navigate = useNavigate();
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
    if (collapseSignal > 0) {
      setCollapsed(forceCollapsed);
    }
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
    <div className="border-b border-subtle">
      {/* Project header */}
      <div
        data-sidebar-project={project.id}
        onClick={() => onProjectClick(project.id)}
        className={`flex items-center gap-2 px-3 py-2 mx-1 text-sm cursor-pointer hover:bg-tertiary rounded-md transition-colors group ${isActive ? 'bg-tertiary' : ''} ${keyboardFocused ? 'bg-accent/10' : ''}`}
      >
        {hasTasks ? (
          <button
            onClick={toggleCollapse}
            className="text-dim hover:text-[var(--color-text-secondary)] flex-shrink-0"
          >
            <ChevronRight size={12} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          </button>
        ) : (
          <div className="w-3 flex-shrink-0" />
        )}
        <span className={`truncate ${isActive ? 'text-accent' : 'text-[var(--color-text-primary)]'}`}>
          {project.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); pinMutation.mutate(); }}
          className={`flex-shrink-0 transition-colors ${
            project.pinned
              ? 'text-accent hover:text-[var(--color-text-primary)]'
              : 'text-transparent group-hover:text-dim hover:!text-accent'
          }`}
          title={project.pinned ? 'unpin project' : 'pin project'}
        >
          <Pin size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onProjectFilterClick(project.id); }}
          className={`flex-shrink-0 transition-colors ${
            isFiltered
              ? 'text-accent hover:text-[var(--color-text-primary)]'
              : 'text-transparent group-hover:text-dim hover:!text-accent'
          }`}
          title={isFiltered ? 'project filter active' : 'filter dashboard by project'}
        >
          <Funnel size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/settings`); onClose?.(); }}
          className="flex-shrink-0 text-transparent group-hover:text-dim hover:!text-accent transition-colors"
          title="project settings"
        >
          <Settings size={12} />
        </button>
        {hasTasks && (
          <span className="text-xs text-dim ml-auto flex-shrink-0">{sortedTasks.length}</span>
        )}
      </div>

      {/* Tasks (when expanded) */}
      {!collapsed && (
        <div className="pb-1">
          {sortedTasks.map((task) => (
            <SidebarTaskNode key={task.id} task={task} onClose={onClose} keyboardFocused={focusedTaskId === task.id} />
          ))}
          <QuickAddTask projectId={project.id} onClose={onClose} />
        </div>
      )}
    </div>
  );
}

// --- Quick Add Task ---

interface QuickAddTaskProps {
  projectId: string;
  onClose?: () => void;
}

function QuickAddTask({ projectId, onClose }: QuickAddTaskProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Step 1: create in backlog
  const createMutation = useMutation({
    mutationFn: (taskTitle: string) =>
      tasksApi.create(projectId, { title: taskTitle }),
  });

  // Step 2: move to in_progress (triggers workflow)
  const moveMutation = useMutation({
    mutationFn: (taskId: string) =>
      tasksApi.update(taskId, { status: TASK_STATUS.IN_PROGRESS }),
    onSuccess: (data: UpdateTaskResponse) => {
      invalidateTaskQueries(queryClient, data.id);
      navigate(`/tasks/${data.id}`);
      onClose?.();
    },
  });

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }

    const task = await createMutation.mutateAsync(trimmed);
    setTitle('');
    setEditing(false);
    moveMutation.mutate(task.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setTitle('');
      setEditing(false);
    }
  };

  const isPending = createMutation.isPending || moveMutation.isPending;

  if (editing) {
    return (
      <div className="px-6 py-1">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          disabled={isPending}
          placeholder="task title..."
          className="w-full text-xs px-2 py-1 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] placeholder:text-dim"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full px-6 py-1 text-[11px] text-dim hover:text-accent transition-colors text-left"
    >
      + Task
    </button>
  );
}

// --- Task Node ---

interface SidebarTaskNodeProps {
  task: SidebarTask;
  onClose?: () => void;
  keyboardFocused?: boolean;
}

function SidebarTaskNode({ task, onClose, keyboardFocused }: SidebarTaskNodeProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = () => {
    navigate(`/tasks/${task.id}`);
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
        className={`flex items-center gap-1.5 px-6 py-1 mx-1 text-xs cursor-pointer hover:bg-tertiary rounded-md transition-colors group ${keyboardFocused ? 'bg-accent/10' : ''}`}
      >
        <TaskStatusIcon status={task.status} />
        <span className="truncate flex-1 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
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
          onClose={onClose}
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
  taskId: string;
  onClose?: () => void;
}

function SidebarSessionNode({ session, taskId, onClose }: SidebarSessionNodeProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/tasks/${taskId}?session=${session.id}`);
    onClose?.();
  };

  return (
    <div
      onClick={handleClick}
      className="flex items-center gap-2 px-8 py-1 text-[11px] cursor-pointer hover:bg-tertiary transition-colors"
    >
      <StatusDot status={session.status} />
      <span className="text-dim">
        {session.provider} #{session.number}
      </span>
    </div>
  );
}

// --- Status Dot ---

function StatusDot({ status }: { status: string }) {
  if (status === 'running') {
    return <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />;
  }
  if (status === 'waiting_input') {
    return <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] flex-shrink-0 animate-pulse" />;
  }
  // idle
  return <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-dim)] flex-shrink-0" />;
}

// --- Status Icon (shown before each task name) ---

function TaskStatusIcon({ status }: { status: string }) {
  if (status === TASK_STATUS.IN_REVIEW) {
    return <GitPullRequest size={12} className="flex-shrink-0" style={{ color: 'var(--color-status-in-review)' }} />;
  }
  // Branch icon — green (in_progress)
  return <GitBranch size={12} className="flex-shrink-0" style={{ color: 'var(--color-status-in-progress)' }} />;
}
