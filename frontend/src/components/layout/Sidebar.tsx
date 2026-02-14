import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronUp, X, Settings, PanelLeftClose, PanelLeftOpen, FolderOpen, BookPlus } from 'lucide-react';
import { TASK_STATUS } from '../../api';
import type { SidebarData } from '../../api';
import { useSidebarData } from '../../hooks/useSidebarData';
import { useMobile } from '../../hooks/useMobile';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { useSidebarFocusStore } from '../../stores/sidebarFocus';
import { useSidebarStore } from '../../stores/sidebar';
import { CreateProjectModal } from '../common/CreateProjectModal';
import { CodeburgIcon, CodeburgWordmark } from '../ui/CodeburgIcon';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';
import { CollapsedProjectIndicators, HiddenProjectsSection, SidebarProjectNode } from './SidebarNodes';

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

export function countWaiting(data: SidebarData | undefined): number {
  if (!data?.projects) return 0;
  let n = 0;
  for (const p of data.projects) {
    for (const s of p.sessions) {
      if (s.status === 'waiting_input') n++;
    }
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
  const { navigateToPanel, closePanel } = usePanelNavigation();
  const isMobile = useMobile();

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
          navigateToPanel(`/projects/${item.id}`);
        } else if (item.type === 'add-task') {
          navigateToPanel(`/tasks/new?project=${item.projectId}&status=${TASK_STATUS.IN_PROGRESS}`);
        } else {
          navigateToPanel(`/tasks/${item.id}`);
        }
      },
    },
    enabled: sidebarFocused && !onClose, // desktop only
  });

  const handleProjectClick = (projectId: string) => {
    navigateToPanel(`/projects/${projectId}`);
    onClose?.();
  };

  const handleProjectFilterClick = (projectId: string, isFiltered: boolean) => {
    if (isFiltered) {
      navigate('/');
    } else {
      navigate(`/?project=${projectId}`);
    }
    onClose?.();
  };

  const handleHomeClick = () => {
    sessionStorage.removeItem('codeburg:active-project');
    closePanel();
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
  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;
  const sidebarContainerStyle = {
    ...(sidebarStyle ?? {}),
    ...(desktopTopInset > 0 ? { paddingTop: `${desktopTopInset}px` } : {}),
  };

  // --- Collapsed mode ---
  if (collapsed) {
    return (
      <aside
        className={`bg-canvas flex flex-col h-full`}
        style={sidebarContainerStyle}
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

        {/* Footer: new project, settings, expand */}
        <div className="px-1.5 pb-2 flex flex-col items-center gap-1">
          <button
            onClick={() => setShowCreateProject(true)}
            className="p-1 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
            title="New project"
          >
            <BookPlus size={18} />
          </button>
          <button
            onClick={handleSettingsClick}
            className={`p-1 hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors ${location.pathname === '/settings' ? 'text-accent' : 'text-dim'}`}
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={toggleExpanded}
            className="p-1 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>

        {showCreateProject && (
          <CreateProjectModal onClose={() => setShowCreateProject(false)} />
        )}
      </aside>
    );
  }

  // --- Expanded mode ---
  const projectTree = isLoading ? (
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
              navigateToPanel(`/tasks/new?project=${project.id}&status=${TASK_STATUS.IN_PROGRESS}`);
              onClose?.();
            }}
            mobile={isMobile}
          />
        );
      })}
    </>
  );

  if (isMobile) {
    return (
      <aside className="bg-canvas flex flex-col h-full w-full">
        {/* Header — simple title, no logo */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Projects</h2>
          {sidebar?.projects && sidebar.projects.length > 0 && (
            <button
              onClick={toggleCollapseAll}
              className="p-1 text-dim hover:text-[var(--color-text-secondary)] rounded-md transition-colors"
              title={allCollapsed ? 'expand all' : 'collapse all'}
            >
              {allCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
        </div>

        {/* Scrollable tree */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {projectTree}
        </div>

        {/* Hidden projects */}
        {hiddenProjects.length > 0 && (
          <HiddenProjectsSection
            projects={hiddenProjects}
            expanded={showHidden}
            onToggle={() => setShowHidden((v) => !v)}
            onProjectClick={handleProjectClick}
            activeProjectPageId={activeProjectPageId}
          />
        )}

        {/* Footer — New Project button, padded for MobileTabBar */}
        <div className="p-3 pb-16">
          <button
            onClick={() => setShowCreateProject(true)}
            className="w-full px-3 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors flex items-center justify-center gap-1.5"
          >
            <BookPlus size={14} />
            New Project
          </button>
        </div>

        {showCreateProject && (
          <CreateProjectModal onClose={() => setShowCreateProject(false)} />
        )}
      </aside>
    );
  }

  return (
    <aside
      className={`bg-canvas flex flex-col h-full ${width ? '' : 'w-72'}`}
      style={sidebarContainerStyle}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            onClick={handleHomeClick}
            className="flex items-center hover:opacity-80 transition-opacity cursor-pointer"
          >
            <CodeburgWordmark height={22} />
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
        {projectTree}
      </div>

      {/* Hidden projects — sticky above footer, expands upward */}
      {hiddenProjects.length > 0 && (
        <HiddenProjectsSection
          projects={hiddenProjects}
          expanded={showHidden}
          onToggle={() => setShowHidden((v) => !v)}
          onProjectClick={handleProjectClick}
          activeProjectPageId={activeProjectPageId}
        />
      )}

      {/* Footer */}
      <div className="p-3 flex gap-2">
        <button
          onClick={() => setShowCreateProject(true)}
          className="flex-1 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors flex items-center justify-center gap-1.5"
          title="New project"
        >
          <BookPlus size={14} />
          Project
        </button>
        <button
          onClick={handleSettingsClick}
          className={`px-2 py-2 hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors ${location.pathname === '/settings' ? 'text-accent' : 'text-dim'}`}
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={toggleExpanded}
          className="px-2 py-2 text-dim hover:text-[var(--color-text-primary)] bg-tertiary hover:bg-[var(--color-border)] rounded-md transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} />
      )}
    </aside>
  );
}
