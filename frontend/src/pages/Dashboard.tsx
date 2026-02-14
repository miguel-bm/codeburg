import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetHeader } from '../components/layout/Header';
import { tasksApi, projectsApi, invalidateTaskQueries } from '../api';
import type { Task, TaskStatus, UpdateTaskResponse } from '../api';
import { TASK_STATUS } from '../api';
import { useMobile } from '../hooks/useMobile';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { usePanelNavigation } from '../hooks/usePanelNavigation';
import { useSidebarFocusStore } from '../stores/sidebarFocus';
import { COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS } from '../constants/tasks';
import {
  DASHBOARD_STATUS_PARAM,
  DASHBOARD_PRIORITY_PARAM,
  DASHBOARD_TYPE_PARAM,
  DASHBOARD_LABEL_PARAM,
} from '../components/dashboard/FilterMenu';
import { DashboardBoardContent } from '../components/dashboard/DashboardBoardContent';
import { DashboardHeaderControls } from '../components/dashboard/DashboardHeaderControls';
import { DashboardOverlays } from '../components/dashboard/DashboardOverlays';
import { useDashboardFocusSync } from './dashboard/useDashboardFocusSync';

const CREATE_TASK_STATUSES = new Set<TaskStatus>([
  TASK_STATUS.BACKLOG,
  TASK_STATUS.IN_PROGRESS,
]);

function canCreateTaskInStatus(status: TaskStatus): boolean {
  return CREATE_TASK_STATUSES.has(status);
}

interface ContextMenu {
  taskId: string;
  x: number;
  y: number;
}

const SESSION_KEY = 'codeburg:active-project';

interface DashboardProps {
  panelOpen?: boolean;
}

type DashboardView = 'kanban' | 'list';

const DASHBOARD_VIEW_PARAM = 'view';

function parseDashboardView(value: string | null): DashboardView {
  return value === 'list' ? 'list' : 'kanban';
}

function parseCsvParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function Dashboard({ panelOpen = false }: DashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = searchParams.get('project') || undefined;
  const view = parseDashboardView(searchParams.get(DASHBOARD_VIEW_PARAM));
  const statusFilter = useMemo(() => {
    const allowed = new Set(COLUMNS.map((column) => column.id));
    return new Set(
      parseCsvParam(searchParams.get(DASHBOARD_STATUS_PARAM))
        .filter((status): status is TaskStatus => allowed.has(status as TaskStatus)),
    );
  }, [searchParams]);
  const priorityFilter = useMemo(() => new Set(parseCsvParam(searchParams.get(DASHBOARD_PRIORITY_PARAM))), [searchParams]);
  const typeFilter = useMemo(() => new Set(parseCsvParam(searchParams.get(DASHBOARD_TYPE_PARAM))), [searchParams]);
  const labelFilter = useMemo(() => new Set(parseCsvParam(searchParams.get(DASHBOARD_LABEL_PARAM))), [searchParams]);
  const hasStatusFilter = statusFilter.size > 0;
  const hasPriorityFilter = priorityFilter.size > 0;
  const hasTypeFilter = typeFilter.size > 0;
  const hasLabelFilter = labelFilter.size > 0;

  // Restore project filter from sessionStorage on mount
  useEffect(() => {
    if (!searchParams.get('project')) {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const next = new URLSearchParams(searchParams);
        next.set('project', stored);
        setSearchParams(next, { replace: true });
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync selected project to sessionStorage
  useEffect(() => {
    if (selectedProjectId) {
      sessionStorage.setItem(SESSION_KEY, selectedProjectId);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, [selectedProjectId]);
  const updateDashboardParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const clearDashboardFilters = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    const next = new URLSearchParams(searchParams);
    next.delete('project');
    next.delete(DASHBOARD_STATUS_PARAM);
    next.delete(DASHBOARD_PRIORITY_PARAM);
    next.delete(DASHBOARD_TYPE_PARAM);
    next.delete(DASHBOARD_LABEL_PARAM);
    // Remove legacy filter params that may still exist in old links.
    next.delete('pinned');
    next.delete('has_pr');
    next.delete('has_branch');
    next.delete('q');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [workflowPrompt, setWorkflowPrompt] = useState<{ taskId: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const queryClient = useQueryClient();
  const { navigateToPanel } = usePanelNavigation();
  const isMobile = useMobile();
  const sidebarFocused = useSidebarFocusStore((s) => s.focused);
  const enterSidebar = useSidebarFocusStore((s) => s.enter);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchExpanded(false);
  }, []);

  useEffect(() => {
    if (searchExpanded) {
      // Small delay to let the width transition start before focusing
      const id = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [searchExpanded]);

  const { data: activeTasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => tasksApi.list(selectedProjectId ? { project: selectedProjectId } : undefined),
  });

  const { data: archivedTasks } = useQuery({
    queryKey: ['tasks', selectedProjectId, 'archived'],
    queryFn: () => tasksApi.list({ project: selectedProjectId, archived: true }),
    enabled: showArchived,
  });

  const tasks = useMemo(() => {
    if (!showArchived || !archivedTasks) return activeTasks;
    return [...(activeTasks ?? []), ...archivedTasks];
  }, [activeTasks, archivedTasks, showArchived]);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status?: TaskStatus; position?: number }) =>
      tasksApi.update(id, { status, position }),
    onSuccess: (data: UpdateTaskResponse) => {
      invalidateTaskQueries(queryClient, data.id);
      if (data.worktreeWarning?.length) {
        setWarning(data.worktreeWarning.join('; '));
      }
      if (data.workflowError) {
        setWarning((prev) => prev ? `${prev}; ${data.workflowError}` : data.workflowError!);
      }
      if (data.workflowAction === 'ask') {
        setWorkflowPrompt({ taskId: data.id });
      } else if (data.sessionStarted) {
        navigateToPanel(`/tasks/${data.id}`);
      }
    },
  });

  const archiveTaskMutation = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      tasksApi.update(id, { archived: archive }),
    onSuccess: (data: UpdateTaskResponse, { archive }) => {
      invalidateTaskQueries(queryClient, data.id);
      // Auto-enable "show archived" so the user sees the dimmed task
      if (archive && !showArchived) setShowArchived(true);
    },
  });

  const handleArchive = useCallback((taskId: string, archive: boolean) => {
    archiveTaskMutation.mutate({ id: taskId, archive });
  }, [archiveTaskMutation]);

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => {
      invalidateTaskQueries(queryClient);
      setPendingDelete(null);
    },
  });

  const projectNamesById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project.name])),
    [projects],
  );

  const getProjectName = useCallback(
    (projectId: string): string => projectNamesById.get(projectId) ?? 'unknown',
    [projectNamesById],
  );

  const availablePriorities = useMemo(() => {
    const priorities = new Set<string>();
    for (const task of tasks ?? []) {
      if (task.priority) priorities.add(task.priority);
    }
    const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    return Array.from(priorities).sort((a, b) => {
      const aRank = order[a] ?? Number.MAX_SAFE_INTEGER;
      const bRank = order[b] ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.localeCompare(b);
    });
  }, [tasks]);

  const availableTaskTypes = useMemo(() => {
    const taskTypes = new Set<string>();
    for (const task of tasks ?? []) {
      if (task.taskType) taskTypes.add(task.taskType);
    }
    return Array.from(taskTypes).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const availableLabels = useMemo(() => {
    const labelMap = new Map<string, { id: string; name: string }>();
    for (const task of tasks ?? []) {
      for (const label of task.labels) {
        if (!labelMap.has(label.id)) {
          labelMap.set(label.id, { id: label.id, name: label.name });
        }
      }
    }
    return Array.from(labelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const searchQueryLower = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const filteredTasks = useMemo(() => {
    return (tasks ?? []).filter((task) => {
      if (hasStatusFilter && !statusFilter.has(task.status)) return false;
      if (hasPriorityFilter && !priorityFilter.has(task.priority ?? '')) return false;
      if (hasTypeFilter && !typeFilter.has(task.taskType)) return false;
      if (hasLabelFilter && !task.labels.some((label) => labelFilter.has(label.id))) return false;
      if (searchQueryLower && !task.title.toLowerCase().includes(searchQueryLower) && !(task.description && task.description.toLowerCase().includes(searchQueryLower))) return false;
      return true;
    });
  }, [
    tasks,
    hasStatusFilter,
    statusFilter,
    hasPriorityFilter,
    priorityFilter,
    hasTypeFilter,
    typeFilter,
    hasLabelFilter,
    labelFilter,
    searchQueryLower,
  ]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) {
      map.set(col.id, []);
    }
    for (const task of filteredTasks) {
      const list = map.get(task.status);
      if (list) list.push(task);
    }
    return map;
  }, [filteredTasks]);

  const getTasksByStatus = useCallback(
    (status: TaskStatus): Task[] => tasksByStatus.get(status) ?? [],
    [tasksByStatus],
  );

  const listTasks = useMemo(() => {
    const statusRank = new Map(COLUMNS.map((column, idx) => [column.id, idx]));
    return [...filteredTasks].sort((a, b) => {
      const pinnedDelta = Number(b.pinned) - Number(a.pinned);
      if (pinnedDelta !== 0) return pinnedDelta;
      const rankDelta = (statusRank.get(a.status) ?? 0) - (statusRank.get(b.status) ?? 0);
      if (rankDelta !== 0) return rankDelta;
      if (a.position !== b.position) return a.position - b.position;
      return a.title.localeCompare(b.title);
    });
  }, [filteredTasks]);

  const statusFilterOrder = useMemo(() => COLUMNS.map((column) => column.id), []);
  const priorityFilterOrder = availablePriorities;
  const typeFilterOrder = availableTaskTypes;
  const labelFilterOrder = useMemo(() => availableLabels.map((label) => label.id), [availableLabels]);

  const applyMultiFilter = useCallback((
    param: string,
    next: Set<string>,
    orderedValues: string[],
  ) => {
    const normalized = orderedValues.filter((value) => next.has(value));
    updateDashboardParams({
      [param]: normalized.length === 0 ? null : normalized.join(','),
    });
  }, [updateDashboardParams]);

  const toggleMultiFilterValue = useCallback((
    param: string,
    value: string,
    current: Set<string>,
    orderedValues: string[],
  ) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    applyMultiFilter(param, next, orderedValues);
  }, [applyMultiFilter]);

  const setOnlyMultiFilterValue = useCallback((
    param: string,
    value: string,
  ) => {
    updateDashboardParams({ [param]: value });
  }, [updateDashboardParams]);

  const activeProjectName = selectedProjectId ? getProjectName(selectedProjectId) : 'All projects';
  const activeFilterCount = Number(!!selectedProjectId)
    + Number(hasPriorityFilter)
    + Number(hasTypeFilter)
    + Number(hasLabelFilter);
  const hasAdvancedFilters = hasPriorityFilter || hasTypeFilter || hasLabelFilter;

  const setView = useCallback(
    (nextView: DashboardView) => {
      updateDashboardParams({ [DASHBOARD_VIEW_PARAM]: nextView === 'kanban' ? null : nextView });
    },
    [updateDashboardParams],
  );

  useEffect(() => {
    if (!headerHost) return;
    const update = () => setIsCompact(headerHost.clientWidth < 640);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(headerHost);
    return () => ro.disconnect();
  }, [headerHost]);

  const projectFilterItems = useMemo(
    () => (projects ?? []).filter((p) => !p.hidden).map((project) => ({
      value: project.id,
      label: project.name,
      description: project.path,
    })),
    [projects],
  );

  const statusFilterItems = useMemo(
    () => COLUMNS.map((column) => ({
      value: column.id,
      label: column.title,
      toneClass: column.color,
    })),
    [],
  );

  const priorityFilterItems = useMemo(
    () => availablePriorities.map((priority) => ({
      value: priority,
      label: PRIORITY_LABELS[priority] ? `${PRIORITY_LABELS[priority]} · ${priority}` : priority,
      toneColor: PRIORITY_COLORS[priority] ?? 'var(--color-text-primary)',
    })),
    [availablePriorities],
  );

  const typeFilterItems = useMemo(
    () => availableTaskTypes.map((taskType) => ({
      value: taskType,
      label: taskType,
    })),
    [availableTaskTypes],
  );

  const labelFilterItems = useMemo(
    () => availableLabels.map((label) => ({
      value: label.id,
      label: label.name,
    })),
    [availableLabels],
  );

  const handleSelectProject = useCallback((projectId: string) => {
    updateDashboardParams({ project: projectId });
  }, [updateDashboardParams]);

  const handleClearProject = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    updateDashboardParams({ project: null });
  }, [updateDashboardParams]);

  const handleResetFilterParam = useCallback((param: string) => {
    updateDashboardParams({ [param]: null });
  }, [updateDashboardParams]);

  const handleToggleShowArchived = useCallback(() => {
    setShowArchived((value) => !value);
  }, []);

  useSetHeader(
    <DashboardHeaderControls
      setHeaderHost={setHeaderHost}
      view={view}
      onSetView={setView}
      isCompact={isCompact}
      selectedProjectId={selectedProjectId}
      activeProjectName={activeProjectName}
      projectFilterItems={projectFilterItems}
      statusFilter={statusFilter}
      statusFilterItems={statusFilterItems}
      statusFilterOrder={statusFilterOrder}
      priorityFilter={priorityFilter}
      priorityFilterItems={priorityFilterItems}
      priorityFilterOrder={priorityFilterOrder}
      typeFilter={typeFilter}
      typeFilterItems={typeFilterItems}
      typeFilterOrder={typeFilterOrder}
      labelFilter={labelFilter}
      labelFilterItems={labelFilterItems}
      labelFilterOrder={labelFilterOrder}
      activeFilterCount={activeFilterCount}
      onSelectProject={handleSelectProject}
      onClearProject={handleClearProject}
      onToggleMultiFilter={toggleMultiFilterValue}
      onSetOnlyMultiFilterValue={setOnlyMultiFilterValue}
      onResetFilterParam={handleResetFilterParam}
      onClearDashboardFilters={clearDashboardFilters}
      searchExpanded={searchExpanded}
      searchQuery={searchQuery}
      searchInputRef={searchInputRef}
      onSetSearchExpanded={setSearchExpanded}
      onSetSearchQuery={setSearchQuery}
      onClearSearch={clearSearch}
      showArchived={showArchived}
      onToggleShowArchived={handleToggleShowArchived}
    />,
    `dashboard-${view}-${isCompact}-${searchExpanded}-${searchQuery}-${showArchived}-${selectedProjectId ?? 'none'}-${Array.from(statusFilter).sort().join('.')}-${Array.from(priorityFilter).sort().join('.')}-${Array.from(typeFilter).sort().join('.')}-${Array.from(labelFilter).sort().join('.')}-${(projects ?? []).length}-${availablePriorities.join('.')}-${availableTaskTypes.join('.')}-${availableLabels.map((label) => label.id).join('.')}`,
  );

  const hasProjects = (projects?.length ?? 0) > 0;

  const navigateToCreate = useCallback((status?: TaskStatus) => {
    if (status && !canCreateTaskInStatus(status)) return;
    const targetStatus = status === TASK_STATUS.IN_PROGRESS ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.BACKLOG;
    const params = new URLSearchParams();
    if (selectedProjectId) params.set('project', selectedProjectId);
    if (targetStatus !== TASK_STATUS.BACKLOG) params.set('status', targetStatus);
    const qs = params.toString();
    navigateToPanel(`/tasks/new${qs ? `?${qs}` : ''}`);
  }, [navigateToPanel, selectedProjectId]);

  const getColumnTasks = useCallback(
    (colIdx: number): Task[] => tasksByStatus.get(COLUMNS[colIdx]?.id) ?? [],
    [tasksByStatus],
  );

  const { focus, setFocus, getFocusedTask } = useDashboardFocusSync({
    panelOpen,
    tasks,
    tasksByStatus,
    selectedProjectId,
    statusFilter,
    priorityFilter,
    typeFilter,
    labelFilter,
    getColumnTasks,
    navigateToPanel,
    isMobile,
    setActiveColumnIndex,
  });

  // Restore kanban focus when sidebar exits
  const prevSidebarFocused = useRef(false);
  useEffect(() => {
    if (prevSidebarFocused.current && !sidebarFocused) {
      setFocus({ col: 0, card: 0 });
      kanbanScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    }
    prevSidebarFocused.current = sidebarFocused;
  }, [sidebarFocused, setFocus]);

  const { drag, setDrag, isDragging, handleMouseDown } = useDragAndDrop({
    columns: COLUMNS,
    getColumnTasks,
    tasks,
    hasAdvancedFilters,
    enabled: view === 'kanban' && !isMobile,
    columnRefs,
    cardRefs,
    onDrop: useCallback((taskId: string, targetStatus: TaskStatus, position: number) => {
      updateTaskMutation.mutate({ id: taskId, status: targetStatus, position });
    }, [updateTaskMutation]),
    onReorder: useCallback((taskId: string, newPosition: number) => {
      updateTaskMutation.mutate({ id: taskId, position: newPosition });
    }, [updateTaskMutation]),
    onClick: useCallback((task: Task) => {
      navigateToPanel(`/tasks/${task.id}`);
    }, [navigateToPanel]),
  });

  const STATUS_ORDER: TaskStatus[] = COLUMNS.map((c) => c.id);

  const getMaxCard = useCallback(
    (colIdx: number): number => {
      const count = getColumnTasks(colIdx).length;
      const status = COLUMNS[colIdx]?.id;
      if (!status) return 0;
      if (canCreateTaskInStatus(status)) return count;
      return count === 0 ? 0 : count - 1;
    },
    [getColumnTasks],
  );

  // Shared callbacks for keyboard shortcuts
  const moveColumnLeft = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    if (!task || focus.col === 0) return;
    const newCol = focus.col - 1;
    updateTaskMutation.mutate({ id: task.id, status: STATUS_ORDER[newCol] });
    const maxCard = Math.max(getColumnTasks(newCol).length, 0);
    setFocus({ col: newCol, card: Math.min(focus.card, maxCard) });
  }, [focus, getFocusedTask, getColumnTasks, setFocus, updateTaskMutation, STATUS_ORDER]);

  const moveColumnRight = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    if (!task || focus.col >= COLUMNS.length - 1) return;
    const newCol = focus.col + 1;
    updateTaskMutation.mutate({ id: task.id, status: STATUS_ORDER[newCol] });
    const maxCard = Math.max(getColumnTasks(newCol).length, 0);
    setFocus({ col: newCol, card: Math.min(focus.card, maxCard) });
  }, [focus, getFocusedTask, getColumnTasks, setFocus, updateTaskMutation, STATUS_ORDER]);

  const reorderUp = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    if (!task || focus.card === 0) return;
    const newPos = focus.card - 1;
    const colTasks = getColumnTasks(focus.col);
    const targetTask = colTasks[newPos];
    if (!targetTask) return;
    updateTaskMutation.mutate({ id: task.id, position: targetTask.position });
    setFocus({ col: focus.col, card: newPos });
  }, [focus, getFocusedTask, getColumnTasks, setFocus, updateTaskMutation]);

  const reorderDown = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    const colTasks = getColumnTasks(focus.col);
    if (!task || focus.card >= colTasks.length - 1) return;
    const newPos = focus.card + 1;
    const targetTask = colTasks[newPos];
    if (!targetTask) return;
    updateTaskMutation.mutate({ id: task.id, position: targetTask.position });
    setFocus({ col: focus.col, card: newPos });
  }, [focus, getFocusedTask, getColumnTasks, setFocus, updateTaskMutation]);

  const togglePin = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    if (!task) return;
    tasksApi.update(task.id, { pinned: !task.pinned }).then(() => {
      invalidateTaskQueries(queryClient, task.id);
    });
  }, [focus, getFocusedTask, queryClient]);

  const handleNavLeft = useCallback(() => {
    if (!focus || focus.col === 0) {
      enterSidebar();
      setFocus(null);
      kanbanScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    setFocus((f) => {
      const col = Math.max((f?.col ?? 1) - 1, 0);
      return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
    });
  }, [focus, enterSidebar, getMaxCard, setFocus]);

  useKeyboardNav({
    keyMap: {
      ArrowLeft: handleNavLeft,
      h: handleNavLeft,
      ArrowRight: () => setFocus((f) => {
        const col = Math.min((f?.col ?? -1) + 1, COLUMNS.length - 1);
        if (col === COLUMNS.length - 1) {
          kanbanScrollRef.current?.scrollTo({ left: kanbanScrollRef.current.scrollWidth, behavior: 'smooth' });
        }
        return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
      }),
      l: () => setFocus((f) => {
        const col = Math.min((f?.col ?? -1) + 1, COLUMNS.length - 1);
        if (col === COLUMNS.length - 1) {
          kanbanScrollRef.current?.scrollTo({ left: kanbanScrollRef.current.scrollWidth, behavior: 'smooth' });
        }
        return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
      }),
      ArrowUp: () => setFocus((f) => f ? { ...f, card: Math.max(f.card - 1, 0) } : { col: 0, card: 0 }),
      k: () => setFocus((f) => f ? { ...f, card: Math.max(f.card - 1, 0) } : { col: 0, card: 0 }),
      ArrowDown: () => setFocus((f) => {
        const col = f?.col ?? 0;
        return { col, card: Math.min((f?.card ?? -1) + 1, getMaxCard(col)) };
      }),
      j: () => setFocus((f) => {
        const col = f?.col ?? 0;
        return { col, card: Math.min((f?.card ?? -1) + 1, getMaxCard(col)) };
      }),
      Enter: () => {
        if (!focus) return;
        const task = getFocusedTask();
        if (task) {
          navigateToPanel(`/tasks/${task.id}`);
        } else if (hasProjects && canCreateTaskInStatus(COLUMNS[focus.col].id)) {
          navigateToCreate(COLUMNS[focus.col].id);
        }
      },
      Escape: () => setFocus(null),
      // Reorder/move shortcuts only when panel is closed
      ...(!panelOpen && !hasAdvancedFilters ? {
        'Shift+ArrowLeft': moveColumnLeft,
        'Shift+ArrowRight': moveColumnRight,
        'Shift+H': moveColumnLeft,
        'Shift+L': moveColumnRight,
        'Shift+ArrowUp': reorderUp,
        'Shift+ArrowDown': reorderDown,
        'Shift+K': reorderUp,
        'Shift+J': reorderDown,
      } : {}),
      x: togglePin,
      n: () => {
        if (!hasProjects) return;
        const status = COLUMNS[focus?.col ?? 0].id;
        if (canCreateTaskInStatus(status)) {
          navigateToCreate(status);
        }
      },
      p: () => setShowCreateProject(true),
      '1': () => setFocus({ col: 0, card: 0 }),
      '2': () => setFocus({ col: 1, card: 0 }),
      '3': () => setFocus({ col: 2, card: 0 }),
      '4': () => setFocus({ col: 3, card: 0 }),
      '?': () => setShowHelp(true),
    },
    enabled: view === 'kanban' && !showCreateProject && !showHelp && !contextMenu && !drag && !sidebarFocused,
  });

  useEffect(() => {
    if (view === 'list') {
      setContextMenu(null);
      setDrag(null);
    }
  }, [setDrag, view]);

  return (
    <>
      <DashboardOverlays
        warning={warning}
        onDismissWarning={() => setWarning(null)}
        isDragging={isDragging}
        drag={drag}
        tasks={tasks}
        selectedProjectId={selectedProjectId}
        getProjectName={getProjectName}
        contextMenu={contextMenu}
        onCloseContextMenu={() => setContextMenu(null)}
        onContextStatusChange={(taskId, status) => {
          updateTaskMutation.mutate({ id: taskId, status });
          setContextMenu(null);
        }}
        onArchive={handleArchive}
        onDeleteFromContext={(taskId) => setPendingDelete(taskId)}
        showCreateProject={showCreateProject}
        onCloseCreateProject={() => setShowCreateProject(false)}
        workflowPrompt={workflowPrompt}
        onCloseWorkflowPrompt={() => setWorkflowPrompt(null)}
        pendingDelete={pendingDelete}
        onCloseDelete={() => setPendingDelete(null)}
        onConfirmDelete={(taskId) => deleteTaskMutation.mutate(taskId)}
        deletePending={deleteTaskMutation.isPending}
        showHelp={showHelp}
        onCloseHelp={() => setShowHelp(false)}
      />

      <DashboardBoardContent
        view={view}
        listTasks={listTasks}
        tasksLoading={tasksLoading}
        selectedProjectId={selectedProjectId}
        getProjectName={getProjectName}
        onOpenTask={(taskId) => navigateToPanel(`/tasks/${taskId}`)}
        canCreateTask={hasProjects}
        onCreateTask={(status) => {
          if (hasProjects) navigateToCreate(status);
        }}
        isMobile={isMobile}
        activeColumnIndex={activeColumnIndex}
        onSetActiveColumnIndex={setActiveColumnIndex}
        getTasksByStatus={getTasksByStatus}
        focus={focus}
        onSetContextMenu={(menu) => setContextMenu(menu)}
        onArchive={handleArchive}
        canCreateTaskInStatus={canCreateTaskInStatus}
        kanbanScrollRef={kanbanScrollRef}
        columnRefs={columnRefs}
        cardRefs={cardRefs}
        isDragging={isDragging}
        drag={drag}
        onTaskMouseDown={handleMouseDown}
      />

    </>
  );
}
