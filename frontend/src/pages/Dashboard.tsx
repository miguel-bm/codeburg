import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { X, LayoutGrid, List as ListIcon, Search } from 'lucide-react';
import { useSetHeader } from '../components/layout/Header';
import { tasksApi, projectsApi, invalidateTaskQueries } from '../api';
import type { Task, TaskStatus, UpdateTaskResponse } from '../api';
import { TASK_STATUS } from '../api';
import { useMobile } from '../hooks/useMobile';
import { useSwipe } from '../hooks/useSwipe';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { HelpOverlay } from '../components/common/HelpOverlay';
import { CreateProjectModal } from '../components/common/CreateProjectModal';
import { usePanelNavigation } from '../hooks/usePanelNavigation';
import { useSidebarFocusStore } from '../stores/sidebarFocus';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { COLUMNS, COLUMN_ICONS, PRIORITY_COLORS, PRIORITY_LABELS } from '../constants/tasks';
import {
  FilterMenu,
  CompactFilterPanel,
  DASHBOARD_STATUS_PARAM,
  DASHBOARD_PRIORITY_PARAM,
  DASHBOARD_TYPE_PARAM,
  DASHBOARD_LABEL_PARAM,
} from '../components/dashboard/FilterMenu';
import { TaskCard, DropPlaceholder, NewTaskPlaceholder } from '../components/dashboard/TaskCard';
import { TaskListView } from '../components/dashboard/TaskListView';
import { TaskContextMenu } from '../components/dashboard/TaskContextMenu';
import { WorkflowPromptModal } from '../components/dashboard/WorkflowPromptModal';

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
  const [focus, setFocus] = useState<{ col: number; card: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
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

  // Restore kanban focus when sidebar exits
  const prevSidebarFocused = useRef(false);
  useEffect(() => {
    if (prevSidebarFocused.current && !sidebarFocused) {
      setFocus({ col: 0, card: 0 });
      kanbanScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    }
    prevSidebarFocused.current = sidebarFocused;
  }, [sidebarFocused]);

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

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => setActiveColumnIndex((i) => Math.min(i + 1, COLUMNS.length - 1)),
    onSwipeRight: () => setActiveColumnIndex((i) => Math.max(i - 1, 0)),
    threshold: 50,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => tasksApi.list(selectedProjectId ? { project: selectedProjectId } : undefined),
  });

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

  useSetHeader(
    <div ref={setHeaderHost} className="flex items-center gap-2 w-full">
      {/* View toggle — animated sliding indicator, always icon-only */}
      <div className="relative inline-flex items-center rounded-md bg-tertiary p-0.5 shrink-0">
        {([{ key: 'kanban' as DashboardView, icon: LayoutGrid }, { key: 'list' as DashboardView, icon: ListIcon }] as const).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setView(opt.key)}
            className={`relative inline-flex items-center justify-center w-7 h-6 rounded-[5px] transition-colors ${
              view === opt.key
                ? 'text-accent'
                : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
            title={`${opt.key === 'kanban' ? 'Kanban' : 'List'} view`}
          >
            {view === opt.key && (
              <motion.div
                layoutId="view-indicator"
                className="absolute inset-0 rounded-[5px] bg-accent/15"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <opt.icon size={12} className="relative z-[1]" />
          </button>
        ))}
      </div>

      {/* Filters — compact or expanded */}
      {isCompact ? (
        <CompactFilterPanel
          selectedProjectId={selectedProjectId}
          projectFilterItems={projectFilterItems}
          showStatusFilter={false}
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
          onSelectProject={(projectId) => updateDashboardParams({ project: projectId })}
          onClearProject={() => {
            sessionStorage.removeItem(SESSION_KEY);
            updateDashboardParams({ project: null });
          }}
          onToggleMultiFilter={toggleMultiFilterValue}
          onResetAll={clearDashboardFilters}
        />
      ) : (
        <div className="flex items-center gap-1.5 min-w-0">
          <FilterMenu
            mode="single"
            label="Project"
            selectedValue={selectedProjectId}
            selectedLabel={activeProjectName}
            items={projectFilterItems}
            allLabel="All projects"
            emptyMessage="No projects found."
            onSelect={(projectId) => {
              updateDashboardParams({ project: projectId });
            }}
            onClear={() => {
              sessionStorage.removeItem(SESSION_KEY);
              updateDashboardParams({ project: null });
            }}
            menuWidth={460}
            searchable
          />

          <FilterMenu
            mode="multi"
            label="Priority"
            selected={priorityFilter}
            items={priorityFilterItems}
            emptyMessage="No priorities found."
            onToggle={(value) => toggleMultiFilterValue(
              DASHBOARD_PRIORITY_PARAM,
              value,
              priorityFilter,
              priorityFilterOrder,
            )}
            onOnly={(value) => setOnlyMultiFilterValue(DASHBOARD_PRIORITY_PARAM, value)}
            onReset={() => updateDashboardParams({ [DASHBOARD_PRIORITY_PARAM]: null })}
          />

          <FilterMenu
            mode="multi"
            label="Type"
            selected={typeFilter}
            items={typeFilterItems}
            emptyMessage="No task types found."
            onToggle={(value) => toggleMultiFilterValue(
              DASHBOARD_TYPE_PARAM,
              value,
              typeFilter,
              typeFilterOrder,
            )}
            onOnly={(value) => setOnlyMultiFilterValue(DASHBOARD_TYPE_PARAM, value)}
            onReset={() => updateDashboardParams({ [DASHBOARD_TYPE_PARAM]: null })}
            searchable
          />

          <FilterMenu
            mode="multi"
            label="Label"
            selected={labelFilter}
            items={labelFilterItems}
            emptyMessage="No labels found."
            onToggle={(value) => toggleMultiFilterValue(
              DASHBOARD_LABEL_PARAM,
              value,
              labelFilter,
              labelFilterOrder,
            )}
            onOnly={(value) => setOnlyMultiFilterValue(DASHBOARD_LABEL_PARAM, value)}
            onReset={() => updateDashboardParams({ [DASHBOARD_LABEL_PARAM]: null })}
            searchable
          />
        </div>
      )}

      {/* Search — expanding inline field */}
      <div
        className={`inline-flex h-7 items-center rounded-lg shrink-0 overflow-hidden transition-all duration-200 ease-out ${
          searchQuery
            ? 'bg-accent/10'
            : searchExpanded
              ? 'bg-tertiary'
              : ''
        }`}
        style={{ width: searchExpanded ? 200 : 28 }}
      >
        <button
          type="button"
          onClick={() => { if (!searchExpanded) setSearchExpanded(true); }}
          className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors ${
            searchQuery
              ? 'text-accent'
              : searchExpanded
                ? 'text-dim'
                : 'text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
          }`}
        >
          <Search size={12} />
        </button>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') clearSearch(); }}
          placeholder="Search..."
          className={`flex-1 min-w-0 h-7 bg-transparent text-[11px] focus:outline-none ${
            searchQuery
              ? 'text-accent placeholder:text-accent/50'
              : 'text-[var(--color-text-primary)] placeholder:text-dim'
          }`}
          tabIndex={searchExpanded ? 0 : -1}
        />
        <button
          type="button"
          onClick={clearSearch}
          className={`shrink-0 w-6 h-7 inline-flex items-center justify-center transition-colors ${
            searchQuery
              ? 'text-accent/60 hover:text-accent'
              : 'text-dim hover:text-[var(--color-text-primary)]'
          }`}
          tabIndex={searchExpanded ? 0 : -1}
        >
          <X size={12} />
        </button>
      </div>

      {/* Clear — always visible, pinned right */}
      {activeFilterCount > 0 && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-dim">{activeFilterCount}</span>
          <Button
            variant="ghost"
            size="xs"
            icon={<X size={12} />}
            onClick={clearDashboardFilters}
            title="Clear all filters"
          >
            Clear
          </Button>
        </div>
      )}
    </div>,
    `dashboard-${view}-${isCompact}-${searchExpanded}-${searchQuery}-${selectedProjectId ?? 'none'}-${Array.from(statusFilter).sort().join('.')}-${Array.from(priorityFilter).sort().join('.')}-${Array.from(typeFilter).sort().join('.')}-${Array.from(labelFilter).sort().join('.')}-${(projects ?? []).length}-${availablePriorities.join('.')}-${availableTaskTypes.join('.')}-${availableLabels.map((label) => label.id).join('.')}`,
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

  const getFocusedTask = useCallback((): Task | null => {
    if (!focus) return null;
    const col = getColumnTasks(focus.col);
    return col[focus.card] ?? null;
  }, [focus, getColumnTasks]);

  // Auto-select first task on initial load or when filters change
  const focusSelectionKey = useMemo(
    () => [
      selectedProjectId ?? '',
      Array.from(statusFilter).sort().join(','),
      Array.from(priorityFilter).sort().join(','),
      Array.from(typeFilter).sort().join(','),
      Array.from(labelFilter).sort().join(','),
    ].join('|'),
    [
      selectedProjectId,
      statusFilter,
      priorityFilter,
      typeFilter,
      labelFilter,
    ],
  );
  const prevFocusSelectionKey = useRef(focusSelectionKey);
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!tasks) return;
    const filtersChanged = prevFocusSelectionKey.current !== focusSelectionKey;
    prevFocusSelectionKey.current = focusSelectionKey;
    if (hasInitialized.current && !filtersChanged) return;
    hasInitialized.current = true;
    for (let col = 0; col < COLUMNS.length; col++) {
      const colTasks = tasksByStatus.get(COLUMNS[col].id) ?? [];
      if (colTasks.length > 0) {
        setFocus({ col, card: 0 });
        return;
      }
    }
    setFocus({ col: 0, card: 0 });
  }, [focusSelectionKey, tasks, tasksByStatus]);

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
  }, [focus, getFocusedTask, getColumnTasks, updateTaskMutation, STATUS_ORDER]);

  const moveColumnRight = useCallback(() => {
    if (!focus) return;
    const task = getFocusedTask();
    if (!task || focus.col >= COLUMNS.length - 1) return;
    const newCol = focus.col + 1;
    updateTaskMutation.mutate({ id: task.id, status: STATUS_ORDER[newCol] });
    const maxCard = Math.max(getColumnTasks(newCol).length, 0);
    setFocus({ col: newCol, card: Math.min(focus.card, maxCard) });
  }, [focus, getFocusedTask, getColumnTasks, updateTaskMutation, STATUS_ORDER]);

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
  }, [focus, getFocusedTask, getColumnTasks, updateTaskMutation]);

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
  }, [focus, getFocusedTask, getColumnTasks, updateTaskMutation]);

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
  }, [focus, enterSidebar, getMaxCard]);

  // --- Bidirectional sync: kanban focus ↔ panel URL ---
  const location = useLocation();
  const syncFromUrl = useRef(false); // prevents focus→URL loop
  const getPanelTaskIdFromPath = useCallback((pathname: string): string | null => {
    const match = pathname.match(/^\/tasks\/([^/]+)$/);
    if (!match) return null;
    const taskId = match[1];
    if (taskId === 'new' || taskId === 'quick') return null;
    return taskId;
  }, []);

  // Reverse sync: panel URL → kanban focus
  // When the URL changes to /tasks/:id (e.g. clicking a card), highlight that card in the kanban
  useEffect(() => {
    if (!panelOpen || !tasks) return;
    const panelTaskId = getPanelTaskIdFromPath(location.pathname);
    if (!panelTaskId) return;

    // Find the task in the kanban and set focus to it
    for (let col = 0; col < COLUMNS.length; col++) {
      const colTasks = tasksByStatus.get(COLUMNS[col].id) ?? [];
      const cardIdx = colTasks.findIndex((t) => t.id === panelTaskId);
      if (cardIdx >= 0) {
        // Only update if focus doesn't already point here
        if (!focus || focus.col !== col || focus.card !== cardIdx) {
          syncFromUrl.current = true;
          setFocus({ col, card: cardIdx });
        }
        return;
      }
    }
  }, [location.pathname, panelOpen, tasks, tasksByStatus, focus, getPanelTaskIdFromPath]);

  // Forward sync: kanban focus → panel URL
  // When keyboard nav changes focus while panel is open, update the panel to show that task
  const prevFocus = useRef(focus);
  useEffect(() => {
    if (!panelOpen || !focus) { prevFocus.current = focus; return; }
    const panelTaskId = getPanelTaskIdFromPath(location.pathname);
    if (!panelTaskId) { prevFocus.current = focus; return; }
    // Skip if this focus change came from URL sync (avoid loop)
    if (syncFromUrl.current) { syncFromUrl.current = false; prevFocus.current = focus; return; }
    const changed = !prevFocus.current || prevFocus.current.col !== focus.col || prevFocus.current.card !== focus.card;
    prevFocus.current = focus;
    if (!changed) return;
    const task = getColumnTasks(focus.col)[focus.card];
    if (task && task.id !== panelTaskId) {
      navigateToPanel(`/tasks/${task.id}`, { replace: true });
    }
  }, [focus, panelOpen, location.pathname, navigateToPanel, getColumnTasks, getPanelTaskIdFromPath]);

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

  // Sync mobile tab to focus column
  useEffect(() => {
    if (focus && isMobile) {
      setActiveColumnIndex(focus.col);
    }
  }, [focus, isMobile]);

  useEffect(() => {
    if (view === 'list') {
      setContextMenu(null);
      setDrag(null);
    }
  }, [view]);

  return (
    <>
      {/* Warning Banner */}
      {warning && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
          <span>{warning}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setWarning(null)}
            className="ml-4"
          >
            Dismiss
          </Button>
        </div>
      )}

      {view === 'list' ? (
        <TaskListView
          tasks={listTasks}
          loading={tasksLoading}
          selectedProjectId={selectedProjectId}
          getProjectName={getProjectName}
          onOpenTask={(taskId) => navigateToPanel(`/tasks/${taskId}`)}
          canCreateTask={hasProjects}
          onCreateTask={(status) => {
            if (hasProjects) navigateToCreate(status);
          }}
        />
      ) : (
        <>
          {isMobile ? (
            // Mobile: Tabbed columns with swipe navigation
            <div className="flex flex-col h-full">
              {/* Tab Navigation */}
              <div className="flex overflow-x-auto">
                {COLUMNS.map((column, index) => {
                  const TabIcon = COLUMN_ICONS[column.id];
                  return (
                    <button
                      key={column.id}
                      onClick={() => setActiveColumnIndex(index)}
                      className={`flex-1 min-w-0 px-3 py-2 text-xs font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                        activeColumnIndex === index
                          ? `${column.color} border-b-2 border-accent`
                          : 'text-dim hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      <TabIcon size={12} />
                      {column.title}
                      <span className="ml-0.5 text-dim">
                        {getTasksByStatus(column.id).length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Swipeable Content */}
              <div
                className="flex-1 overflow-y-auto p-2"
                {...swipeHandlers}
              >
                {tasksLoading ? (
                  <div className="text-center text-dim py-8 text-sm">Loading...</div>
                ) : (
                  <div className="space-y-3">
                    {getTasksByStatus(COLUMNS[activeColumnIndex].id).map((task, cardIdx) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                        isMobile
                        onLongPress={(x, y) => setContextMenu({ taskId: task.id, x, y })}
                        focused={focus?.col === activeColumnIndex && focus?.card === cardIdx}
                      />
                    ))}
                    {canCreateTaskInStatus(COLUMNS[activeColumnIndex].id) && (
                      <NewTaskPlaceholder
                        focused={focus?.col === activeColumnIndex && focus?.card === getTasksByStatus(COLUMNS[activeColumnIndex].id).length}
                        onClick={() => { if (hasProjects) navigateToCreate(COLUMNS[activeColumnIndex].id); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Desktop: Horizontal scrolling kanban with custom DnD
            <div ref={kanbanScrollRef} className="px-3 py-3 h-full overflow-x-auto">
              <div className="flex gap-2 h-full min-w-[1200px]">
                {COLUMNS.map((column, colIdx) => {
                  const colTasks = getTasksByStatus(column.id);
                  const ColIcon = COLUMN_ICONS[column.id];
                  return (
                    <Card
                      key={column.id}
                      padding="none"
                      className={`group flex-1 min-w-0 flex flex-col transition-all duration-150 ${
                        focus?.col === colIdx
                          ? '!border-accent'
                          : ''
                      } ${isDragging && drag?.targetCol === colIdx ? 'drag-target-col' : ''}`}
                    >
                      <div ref={(el) => { columnRefs.current[colIdx] = el; }} className="flex flex-col h-full">
                        {/* Column Header */}
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-between">
                            <h3 className={`text-xs font-medium uppercase tracking-wider ${column.color} flex items-center gap-1.5`}>
                              <ColIcon size={14} className="text-dim" />
                              {column.title}
                            </h3>
                            <Badge variant="count">{colTasks.length}</Badge>
                          </div>
                        </div>

                        {/* Tasks */}
                        <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                          {tasksLoading ? (
                            <div className="text-center text-dim py-4 text-sm">
                              Loading...
                            </div>
                          ) : (
                            <>
                              {colTasks.map((task, cardIdx) => {
                                const isGhost = !!(isDragging && drag?.taskId === task.id);
                                // Show placeholder before this card if it's the drop target.
                                // Suppress when hovering at the original position: calcDropTarget skips
                                // the ghost, so "original spot" = targetPosition === sourceCard + 1 in the same column.
                                const isReturnToOrigin = drag?.sourceCol === colIdx && drag?.sourceCard !== undefined && cardIdx === drag.sourceCard + 1;
                                const showDropPlaceholder = isDragging && drag?.targetCol === colIdx && drag?.targetPosition === cardIdx && drag?.taskId !== task.id && !isReturnToOrigin;
                                return (
                                  <div key={task.id}>
                                    {showDropPlaceholder && (
                                      <DropPlaceholder height={drag!.cardHeight} />
                                    )}
                                    <TaskCard
                                      ref={(el) => {
                                        if (el) cardRefs.current.set(task.id, el);
                                        else cardRefs.current.delete(task.id);
                                      }}
                                      task={task}
                                      projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                                      focused={!!(focus?.col === colIdx && focus?.card === cardIdx)}
                                      ghost={isGhost}
                                      onMouseDown={(e) => handleMouseDown(e, task, colIdx, cardIdx)}
                                    />
                                  </div>
                                );
                              })}
                              {/* Drop placeholder at end of column (suppress if ghost is the last card) */}
                              {isDragging && drag?.targetCol === colIdx && drag?.targetPosition >= colTasks.length
                                && !(drag?.sourceCol === colIdx && drag?.sourceCard === colTasks.length - 1) && (
                                <DropPlaceholder height={drag!.cardHeight} />
                              )}
                              {canCreateTaskInStatus(column.id) && (
                                <NewTaskPlaceholder
                                  focused={focus?.col === colIdx && focus?.card === colTasks.length}
                                  selected={focus?.col === colIdx}
                                  showOnHover
                                  onClick={() => { if (hasProjects) navigateToCreate(column.id); }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Drag overlay (portal) */}
      {isDragging && drag && (() => {
        const draggedTask = (tasks ?? []).find((t) => t.id === drag.taskId);
        if (!draggedTask) return null;
        // Dynamic rotation based on horizontal velocity (clamped)
        const vx = drag.mouseX - drag.initialMouseX;
        const rotation = Math.max(-4, Math.min(4, vx * 0.02));
        return createPortal(
          <div
            className="fixed z-[100] pointer-events-none animate-drag-pickup"
            style={{
              left: drag.mouseX - drag.cardOffsetX,
              top: drag.mouseY - drag.cardOffsetY,
              width: drag.cardWidth,
              transform: `rotate(${rotation}deg) scale(1.03)`,
              willChange: 'transform',
            }}
          >
            <div className="bg-card rounded-lg" style={{ boxShadow: '0 12px 28px oklch(0 0 0 / 0.25), 0 4px 10px oklch(0 0 0 / 0.15)' }}>
              <TaskCard
                task={draggedTask}
                projectName={!selectedProjectId ? getProjectName(draggedTask.projectId) : undefined}
                focused={false}
              />
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* Context Menu for mobile long-press */}
      {contextMenu && (
        <TaskContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          taskId={contextMenu.taskId}
          currentStatus={tasks?.find((t) => t.id === contextMenu.taskId)?.status ?? TASK_STATUS.BACKLOG}
          onClose={() => setContextMenu(null)}
          onStatusChange={(status) => {
            updateTaskMutation.mutate({ id: contextMenu.taskId, status });
            setContextMenu(null);
          }}
        />
      )}

      {/* Create Project Modal */}
      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} />
      )}

      {/* Workflow Prompt Modal */}
      {workflowPrompt && (
        <WorkflowPromptModal
          taskId={workflowPrompt.taskId}
          onClose={() => setWorkflowPrompt(null)}
        />
      )}

      {/* Help Overlay */}
      {showHelp && (
        <HelpOverlay page="dashboard" onClose={() => setShowHelp(false)} />
      )}
    </>
  );
}

