import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, X, Settings, ChevronRight, Pin, PanelLeftClose, PanelLeftOpen, GitPullRequest, GitBranch, Funnel, FolderOpen, Plus, Eye, EyeOff } from 'lucide-react';
import { tasksApi, projectsApi, preferencesApi, invalidateTaskQueries, TASK_STATUS } from '../../api';
import type { SidebarProject, SidebarTask, SidebarSession, SidebarData } from '../../api';
import { useSidebarData } from '../../hooks/useSidebarData';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useSidebarFocusStore } from '../../stores/sidebarFocus';
import { useSidebarStore, selectIsExpanded } from '../../stores/sidebar';
import { CreateProjectModal } from '../common/CreateProjectModal';
import { getSessionStatusMeta } from '../../lib/sessionStatus';
import { CodeburgIcon } from '../ui/CodeburgIcon';

interface FocusableItem {
  type: 'project' | 'task' | 'add-task';
  id: string;
  projectId?: string;
}

interface SidebarProps {
  onClose?: () => void;
  width?: number;
  collapsed?: boolean;
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

export function Sidebar({ onClose, width, collapsed }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [showCreateProject, setShowCreateProject] = useState(false);

  const isExpanded = useSidebarStore(selectIsExpanded);
  const toggleExpanded = useSidebarStore((s) => s.toggleExpanded);

  const activeProjectId = searchParams.get('project') || undefined;
  const projectPageMatch = location.pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  const activeProjectPageId = projectPageMatch?.[1];

  const { data: sidebar, isLoading } = useSidebarData();

  const visibleProjects = useMemo(
    () => (sidebar?.projects ?? []).filter((p) => !p.hidden),
    [sidebar],
  );
  const hiddenProjects = useMemo(
    () => (sidebar?.projects ?? []).filter((p) => p.hidden),
    [sidebar],
  );
  const [showHidden, setShowHidden] = useState(false);

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

  // Build flat list of focusable sidebar items (visible projects only)
  const focusableItems = useMemo((): FocusableItem[] => {
    if (!visibleProjects.length) return [];
    const items: FocusableItem[] = [];
    for (const p of visibleProjects) {
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
        items.push({ type: 'add-task', id: `add-${p.id}`, projectId: p.id });
      }
    }
    return items;
    // collapseVersion/collapseSignal included to recalculate when projects are toggled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProjects, collapseVersion, collapseSignal]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll focused sidebar item into view
  useEffect(() => {
    if (!sidebarFocused || !scrollContainerRef.current) return;
    const item = focusableItems[sidebarIndex];
    if (!item) return;
    const attr = item.type === 'project'
      ? `data-sidebar-project="${item.id}"`
      : item.type === 'add-task'
        ? `data-sidebar-add-task="${item.id}"`
        : `data-sidebar-task="${item.id}"`;
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
        } else if (item.type === 'add-task') {
          navigate(`/tasks/new?project=${item.projectId}&status=${TASK_STATUS.IN_PROGRESS}`);
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
    if (location.pathname === '/settings') {
      navigate(-1);
    } else {
      navigate('/settings');
    }
    onClose?.();
  };

  const sidebarStyle = width ? { width } : undefined;

  // --- Collapsed mode ---
  if (collapsed) {
    return (
      <aside
        className={`bg-canvas flex flex-col h-full`}
        style={sidebarStyle}
      >
        {/* Header: icon logo */}
        <div className="p-2 flex items-center justify-center">
          <button
            onClick={handleHomeClick}
            className="w-8 h-8 rounded-md hover:bg-tertiary text-dim hover:text-[var(--color-text-primary)] transition-colors flex items-center justify-center"
            title="Codeburg"
          >
            <CodeburgIcon size={22} />
          </button>
        </div>

        {/* Project icons */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto py-2">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 p-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-tertiary animate-pulse" />
              ))}
            </div>
          ) : !visibleProjects.length ? (
            <div className="p-2 text-center">
              <span className="text-dim text-xs">--</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              {visibleProjects.map((project) => {
                const isActive = activeProjectPageId === project.id;
                const firstLetter = project.name.charAt(0).toUpperCase();
                return (
                  <div key={project.id} className="flex flex-col items-center">
                    <button
                      data-sidebar-project={project.id}
                      onClick={() => handleProjectClick(project.id)}
                      className={`w-8 h-8 rounded-full text-xs font-medium flex items-center justify-center transition-colors flex-shrink-0 ${
                        isActive
                          ? 'bg-accent/20 text-accent'
                          : 'bg-tertiary text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-primary)]'
                      }`}
                      title={project.name}
                    >
                      {firstLetter}
                    </button>
                    <CollapsedProjectIndicators project={project} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: expand + settings */}
        <div className="p-2 flex flex-col items-center gap-1">
          <button
            onClick={toggleExpanded}
            className="p-1.5 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
            title={isExpanded ? 'collapse sidebar' : 'expand sidebar'}
          >
            {isExpanded ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <button
            onClick={handleSettingsClick}
            className={`p-1.5 hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors ${location.pathname === '/settings' ? 'text-accent' : 'text-dim'}`}
            title="settings"
          >
            <Settings size={14} />
          </button>
        </div>

        {showCreateProject && (
          <CreateProjectModal onClose={() => setShowCreateProject(false)} />
        )}
      </aside>
    );
  }

  // --- Expanded mode ---
  return (
    <aside
      className={`bg-canvas flex flex-col h-full ${width ? '' : 'w-72'}`}
      style={sidebarStyle}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            onClick={handleHomeClick}
            className="flex items-center gap-2 hover:text-accent transition-colors cursor-pointer text-[var(--color-text-primary)]"
          >
            <CodeburgIcon size={22} />
            <h1 className="text-lg font-semibold">Codeburg</h1>
          </div>
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
        ) : !visibleProjects.length && !hiddenProjects.length ? (
          <div className="px-4 py-8 text-sm text-dim text-center flex flex-col items-center gap-2">
            <FolderOpen size={32} className="text-dim" />
            No projects yet
          </div>
        ) : (
          <>
            {visibleProjects.map((project) => {
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
                  addTaskFocused={focusedItem?.type === 'add-task' && focusedItem.projectId === project.id}
                  onOpenWizard={() => {
                    navigate(`/tasks/new?project=${project.id}&status=${TASK_STATUS.IN_PROGRESS}`);
                    onClose?.();
                  }}
                />
              );
            })}
            {hiddenProjects.length > 0 && (
              <HiddenProjectsSection
                projects={hiddenProjects}
                expanded={showHidden}
                onToggle={() => setShowHidden((v) => !v)}
                onProjectClick={handleProjectClick}
                activeProjectPageId={activeProjectPageId}
              />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 flex gap-2">
        <button
          onClick={() => setShowCreateProject(true)}
          className="flex-1 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
        >
          + Project
        </button>
        <button
          onClick={toggleExpanded}
          className="px-2 py-2 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
          title={isExpanded ? 'collapse sidebar' : 'expand sidebar'}
        >
          {isExpanded ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <button
          onClick={handleSettingsClick}
          className={`px-2 py-2 hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors ${location.pathname === '/settings' ? 'text-accent' : 'text-dim'}`}
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
  addTaskFocused?: boolean;
  onOpenWizard: () => void;
}

function SidebarProjectNode({ project, isActive, isFiltered, onProjectClick, onProjectFilterClick, onClose, collapseSignal, forceCollapsed, onCollapseToggle, keyboardFocused, focusedTaskId, addTaskFocused, onOpenWizard }: SidebarProjectNodeProps) {
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
    <div>
      {/* Project header */}
      <div
        data-sidebar-project={project.id}
        onClick={() => onProjectClick(project.id)}
        className={`flex items-center gap-2 px-3 py-2 mx-1 text-sm cursor-pointer hover:bg-tertiary rounded-md transition-colors group ${isActive ? 'bg-tertiary' : ''} ${keyboardFocused ? 'bg-accent/10' : ''}`}
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
              {sortedTasks.map((task) => (
                <SidebarTaskNode key={task.id} task={task} onClose={onClose} keyboardFocused={focusedTaskId === task.id} />
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

function HiddenProjectsSection({ projects, expanded, onToggle, onProjectClick, activeProjectPageId }: HiddenProjectsSectionProps) {
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
    <div className="mt-1 border-t border-subtle">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-dim hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <EyeOff size={12} />
        <span>Hidden ({projects.length})</span>
        <ChevronRight size={10} className={`ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
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
      className={`flex items-center gap-1.5 px-6 py-1 mx-1 text-xs cursor-pointer hover:bg-tertiary rounded-md transition-colors ${keyboardFocused ? 'bg-accent/10' : ''}`}
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
      className="flex items-center gap-2 pl-11 pr-3 py-1 text-[11px] cursor-pointer hover:bg-tertiary transition-colors"
    >
      <StatusDot status={session.status} />
      <span className="text-dim">
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

function CollapsedProjectIndicators({ project }: { project: SidebarProject }) {
  const sortedTasks = [
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW),
    ...project.tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS),
  ];
  const sessions = sortedTasks.flatMap((task) => task.sessions);
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
