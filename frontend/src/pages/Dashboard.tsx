import { useState, useMemo, useEffect, useRef, useCallback, forwardRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { GitBranch, Pin, GitPullRequest, X, Plus, Inbox, Play, Eye, CheckCircle2, Clock, Calendar, LayoutGrid, List as ListIcon, Search, ChevronDown, Check, Crosshair, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSetHeader } from '../components/layout/Header';
import { tasksApi, projectsApi, sessionsApi, invalidateTaskQueries } from '../api';
import type { Task, TaskStatus, UpdateTaskResponse } from '../api';
import { TASK_STATUS } from '../api';
import { useMobile } from '../hooks/useMobile';
import { useSwipe } from '../hooks/useSwipe';
import { useLongPress } from '../hooks/useLongPress';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';
import { CreateProjectModal } from '../components/common/CreateProjectModal';
import { useSidebarFocusStore } from '../stores/sidebarFocus';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

const COLUMN_ICONS: Record<string, LucideIcon> = {
  [TASK_STATUS.BACKLOG]: Inbox,
  [TASK_STATUS.IN_PROGRESS]: Play,
  [TASK_STATUS.IN_REVIEW]: Eye,
  [TASK_STATUS.DONE]: CheckCircle2,
};

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: TASK_STATUS.BACKLOG, title: 'Backlog', color: 'status-backlog' },
  { id: TASK_STATUS.IN_PROGRESS, title: 'In Progress', color: 'status-in-progress' },
  { id: TASK_STATUS.IN_REVIEW, title: 'In Review', color: 'status-in-review' },
  { id: TASK_STATUS.DONE, title: 'Done', color: 'status-done' },
];

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

interface DragState {
  taskId: string;
  sourceCol: number;
  sourceCard: number;
  sourcePosition: number;
  mouseX: number;
  mouseY: number;
  initialMouseX: number;
  initialMouseY: number;
  targetCol: number;
  targetPosition: number;
  cardWidth: number;
  cardHeight: number;
  cardOffsetX: number;
  cardOffsetY: number;
}

const SESSION_KEY = 'codeburg:active-project';

interface DashboardProps {
  panelOpen?: boolean;
}

type DashboardView = 'kanban' | 'list';

const DASHBOARD_VIEW_PARAM = 'view';
const DASHBOARD_STATUS_PARAM = 'status';
const DASHBOARD_PRIORITY_PARAM = 'priority';
const DASHBOARD_TYPE_PARAM = 'type';
const DASHBOARD_LABEL_PARAM = 'label';

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
  const [drag, setDrag] = useState<DragState | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useMobile();
  const sidebarFocused = useSidebarFocusStore((s) => s.focused);
  const enterSidebar = useSidebarFocusStore((s) => s.enter);

  // Restore kanban focus when sidebar exits
  const prevSidebarFocused = useRef(false);
  useEffect(() => {
    if (prevSidebarFocused.current && !sidebarFocused) {
      setFocus({ col: 0, card: 0 });
    }
    prevSidebarFocused.current = sidebarFocused;
  }, [sidebarFocused]);

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
        navigate(`/tasks/${data.id}`);
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

  const filteredTasks = useMemo(() => {
    return (tasks ?? []).filter((task) => {
      if (hasStatusFilter && !statusFilter.has(task.status)) return false;
      if (hasPriorityFilter && !priorityFilter.has(task.priority ?? '')) return false;
      if (hasTypeFilter && !typeFilter.has(task.taskType)) return false;
      if (hasLabelFilter && !task.labels.some((label) => labelFilter.has(label.id))) return false;
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
    + Number(hasStatusFilter)
    + Number(hasPriorityFilter)
    + Number(hasTypeFilter)
    + Number(hasLabelFilter);
  const hasAdvancedFilters = hasStatusFilter || hasPriorityFilter || hasTypeFilter || hasLabelFilter;

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
    () => (projects ?? []).map((project) => ({
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
          showStatusFilter={view === 'list'}
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
          <SingleSelectFilterMenu
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

          {view === 'list' && (
            <MultiSelectFilterMenu
              label="Status"
              selected={statusFilter}
              items={statusFilterItems}
              emptyMessage="No statuses available."
              onToggle={(value) => toggleMultiFilterValue(
                DASHBOARD_STATUS_PARAM,
                value,
                statusFilter,
                statusFilterOrder,
              )}
              onOnly={(value) => setOnlyMultiFilterValue(DASHBOARD_STATUS_PARAM, value)}
              onReset={() => updateDashboardParams({ [DASHBOARD_STATUS_PARAM]: null })}
            />
          )}

          <MultiSelectFilterMenu
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

          <MultiSelectFilterMenu
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

          <MultiSelectFilterMenu
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
    `dashboard-${view}-${isCompact}-${selectedProjectId ?? 'none'}-${Array.from(statusFilter).sort().join('.')}-${Array.from(priorityFilter).sort().join('.')}-${Array.from(typeFilter).sort().join('.')}-${Array.from(labelFilter).sort().join('.')}-${(projects ?? []).length}-${availablePriorities.join('.')}-${availableTaskTypes.join('.')}-${availableLabels.map((label) => label.id).join('.')}`,
  );

  const hasProjects = (projects?.length ?? 0) > 0;

  const navigateToCreate = useCallback((status?: TaskStatus) => {
    if (status && !canCreateTaskInStatus(status)) return;
    const targetStatus = status === TASK_STATUS.IN_PROGRESS ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.BACKLOG;
    const params = new URLSearchParams();
    if (selectedProjectId) params.set('project', selectedProjectId);
    if (targetStatus !== TASK_STATUS.BACKLOG) params.set('status', targetStatus);
    const qs = params.toString();
    navigate(`/tasks/new${qs ? `?${qs}` : ''}`);
  }, [navigate, selectedProjectId]);

  const getColumnTasks = useCallback(
    (colIdx: number): Task[] => tasksByStatus.get(COLUMNS[colIdx]?.id) ?? [],
    [tasksByStatus],
  );

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
      navigate(`/tasks/${task.id}`, { replace: true });
    }
  }, [focus, panelOpen, location.pathname, navigate, getColumnTasks, getPanelTaskIdFromPath]);

  useKeyboardNav({
    keyMap: {
      ArrowLeft: handleNavLeft,
      h: handleNavLeft,
      ArrowRight: () => setFocus((f) => {
        const col = Math.min((f?.col ?? -1) + 1, COLUMNS.length - 1);
        return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
      }),
      l: () => setFocus((f) => {
        const col = Math.min((f?.col ?? -1) + 1, COLUMNS.length - 1);
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
          navigate(`/tasks/${task.id}`);
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

  // --- Custom drag-and-drop (desktop only) ---

  const handleMouseDown = useCallback((e: React.MouseEvent, task: Task, colIdx: number, cardIdx: number) => {
    if (view !== 'kanban' || hasAdvancedFilters || isMobile || e.button !== 0) return;
    const cardEl = cardRefs.current.get(task.id);
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    setDrag({
      taskId: task.id,
      sourceCol: colIdx,
      sourceCard: cardIdx,
      sourcePosition: task.position,
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialMouseX: e.clientX,
      initialMouseY: e.clientY,
      targetCol: colIdx,
      targetPosition: task.position,
      cardWidth: rect.width,
      cardHeight: rect.height,
      cardOffsetX: e.clientX - rect.left,
      cardOffsetY: e.clientY - rect.top,
    });
  }, [view, hasAdvancedFilters, isMobile]);

  // Calculate target column and position from mouse position
  const calcDropTarget = useCallback((mouseX: number, mouseY: number): { col: number; position: number } => {
    // Find target column
    let targetCol = 0;
    for (let i = 0; i < COLUMNS.length; i++) {
      const colEl = columnRefs.current[i];
      if (!colEl) continue;
      const rect = colEl.getBoundingClientRect();
      if (mouseX >= rect.left && mouseX <= rect.right) {
        targetCol = i;
        break;
      }
      // If past the last column, use the last
      if (i === COLUMNS.length - 1) targetCol = i;
      // If between columns, pick closest
      if (mouseX < rect.left) {
        targetCol = i;
        break;
      }
    }

    // Find target position within column
    const colTasks = getColumnTasks(targetCol);
    let targetPosition = colTasks.length; // default: end

    for (let i = 0; i < colTasks.length; i++) {
      const task = colTasks[i];
      // Skip the dragged card in source column
      if (drag && task.id === drag.taskId) continue;
      const cardEl = cardRefs.current.get(task.id);
      if (!cardEl) continue;
      const rect = cardEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (mouseY < midY) {
        targetPosition = i;
        break;
      }
    }

    return { col: targetCol, position: targetPosition };
  }, [getColumnTasks, drag]);

  useEffect(() => {
    if (!drag || view !== 'kanban' || hasAdvancedFilters) return;

    const onMouseMove = (e: MouseEvent) => {
      const { col, position } = calcDropTarget(e.clientX, e.clientY);
      setDrag((d) => d ? { ...d, mouseX: e.clientX, mouseY: e.clientY, targetCol: col, targetPosition: position } : null);
    };

    const onMouseUp = (e: MouseEvent) => {
      setDrag((d) => {
        if (!d) return null;
        const dist = Math.hypot(e.clientX - d.initialMouseX, e.clientY - d.initialMouseY);
        if (dist < 5) {
          // Click — navigate
          const task = (tasks ?? []).find((t) => t.id === d.taskId);
          if (task) navigate(`/tasks/${task.id}`);
        } else {
          // Drop — update task
          const sourceStatus = COLUMNS[d.sourceCol].id;
          const targetStatus = COLUMNS[d.targetCol].id;
          const colTasks = getColumnTasks(d.targetCol);

          if (sourceStatus !== targetStatus) {
            // Cross-column move
            const targetTask = colTasks[d.targetPosition];
            updateTaskMutation.mutate({
              id: d.taskId,
              status: targetStatus,
              position: targetTask ? targetTask.position : colTasks.length,
            });
          } else if (d.targetPosition !== d.sourceCard) {
            // Same-column reorder
            // Map visual index to actual position
            const targetTask = colTasks[d.targetPosition];
            const newPosition = targetTask ? targetTask.position : (colTasks.length > 0 ? colTasks[colTasks.length - 1].position + 1 : 0);
            updateTaskMutation.mutate({
              id: d.taskId,
              position: newPosition,
            });
          }
        }
        return null;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag, view, hasAdvancedFilters, calcDropTarget, tasks, navigate, getColumnTasks, updateTaskMutation]);

  // Is dragging (mouse has moved enough)?
  const isDragging = view === 'kanban'
    && !hasAdvancedFilters
    && drag
    && Math.hypot(drag.mouseX - drag.initialMouseX, drag.mouseY - drag.initialMouseY) >= 5;

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
          onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
          canCreateTask={hasProjects}
          onCreateTask={() => {
            if (hasProjects) navigateToCreate();
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
            <div className="px-3 py-3 h-full overflow-x-auto">
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

interface FilterOptionItem {
  value: string;
  label: string;
  description?: string;
  toneClass?: string;
  toneColor?: string;
}

function buildMenuStyle(trigger: HTMLButtonElement | null, preferredWidth = 280): CSSProperties | null {
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const menuWidth = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - menuWidth - viewportPadding,
  );
  const availableBelow = window.innerHeight - rect.bottom - 10;
  const availableAbove = rect.top - 10;
  const openAbove = availableBelow < 240 && availableAbove > availableBelow;
  const maxHeight = Math.max(180, Math.min(360, openAbove ? availableAbove : availableBelow));
  const top = openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 8) : rect.bottom + 8;
  return {
    position: 'fixed',
    top,
    left,
    width: menuWidth,
    maxHeight,
    zIndex: 1200,
  };
}

interface SingleSelectFilterMenuProps {
  label: string;
  selectedValue?: string;
  selectedLabel: string;
  items: FilterOptionItem[];
  allLabel: string;
  emptyMessage: string;
  onSelect: (value: string) => void;
  onClear: () => void;
  menuWidth?: number;
  searchable?: boolean;
}

function SingleSelectFilterMenu({
  label,
  selectedValue,
  selectedLabel,
  items,
  allLabel,
  emptyMessage,
  onSelect,
  onClear,
  menuWidth = 320,
  searchable = false,
}: SingleSelectFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canSearch = searchable || items.length > 8;

  const reposition = useCallback(() => {
    setMenuStyle(buildMenuStyle(triggerRef.current, menuWidth));
  }, [menuWidth]);

  useEffect(() => {
    if (!open) return;
    reposition();
    const onEscape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    const onOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('keydown', onEscape);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('keydown', onEscape);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || !canSearch) return;
    const id = window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, canSearch]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      return item.label.toLowerCase().includes(normalized)
        || (item.description ?? '').toLowerCase().includes(normalized);
    });
  }, [items, query]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors ${
          selectedValue
            ? 'bg-accent/10 text-accent'
            : 'bg-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
      >
        <span className="font-medium">{label}</span>
        <span className={`max-w-[180px] truncate ${selectedValue ? 'text-accent' : 'text-dim'}`}>
          {selectedValue ? selectedLabel : allLabel}
        </span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[1190] animate-fadeIn"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-elevated shadow-lg shadow-black/35 overflow-hidden flex flex-col animate-scaleIn"
          >
            <div className="px-3 py-2.5 bg-[var(--color-bg-secondary)]/45 flex items-center justify-between">
              <div className="text-xs font-medium">{label}</div>
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setTimeout(() => setOpen(false), 0);
                }}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset
              </button>
            </div>

            {canSearch && (
              <div className="px-3 pb-2">
                <label className="relative block">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className="w-full h-7 rounded-md border border-subtle/30 bg-[var(--color-bg-secondary)]/60 pl-7 pr-2 text-[11px] text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent/55"
                />
              </label>
            </div>
            )}

            <div className="overflow-y-auto p-1.5">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-xs text-dim text-center">{emptyMessage}</div>
              ) : (
                filteredItems.map((item) => {
                  const selected = item.value === selectedValue;
                  return (
                    <div key={item.value} className="flex items-center gap-1 rounded-md hover:bg-tertiary px-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (selected) onClear();
                          else onSelect(item.value);
                        }}
                        className={`flex-1 text-left px-1.5 py-2 text-xs rounded-md transition-colors ${
                          selected ? 'text-accent' : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{item.label}</span>
                          {selected && <Check size={12} className="text-accent shrink-0" />}
                        </div>
                        {item.description && (
                          <div className="text-[10px] text-dim mt-0.5 truncate">{item.description}</div>
                        )}
                      </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.value);
                        setTimeout(() => setOpen(false), 0);
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <Crosshair size={10} />
                      only
                    </button>
                  </div>
                );
                })
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

interface MultiSelectFilterMenuProps {
  label: string;
  selected: Set<string>;
  items: FilterOptionItem[];
  emptyMessage: string;
  onToggle: (value: string) => void;
  onOnly: (value: string) => void;
  onReset: () => void;
  searchable?: boolean;
}

function MultiSelectFilterMenu({
  label,
  selected,
  items,
  emptyMessage,
  onToggle,
  onOnly,
  onReset,
  searchable = false,
}: MultiSelectFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canSearch = searchable || items.length > 7;

  const reposition = useCallback(() => {
    setMenuStyle(buildMenuStyle(triggerRef.current, 300));
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    const onEscape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    const onOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('keydown', onEscape);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('keydown', onEscape);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || !canSearch) return;
    const id = window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, canSearch]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [items, query]);

  const selectedCount = selected.size;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors ${
          selectedCount > 0
            ? 'bg-accent/10 text-accent'
            : 'bg-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
      >
        <span className="font-medium">{label}</span>
        <span className={`${selectedCount > 0 ? 'text-accent' : 'text-dim'}`}>
          {selectedCount > 0 ? `${selectedCount} selected` : 'All'}
        </span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[1190] animate-fadeIn"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-elevated shadow-lg shadow-black/35 overflow-hidden flex flex-col animate-scaleIn"
          >
            <div className="px-3 py-2.5 bg-[var(--color-bg-secondary)]/45 flex items-center justify-between">
              <div className="text-xs font-medium">{label}</div>
              <button
                type="button"
                onClick={onReset}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset
              </button>
            </div>

            {canSearch && (
              <div className="px-3 pb-2">
                <label className="relative block">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className="w-full h-7 rounded-md border border-subtle/30 bg-[var(--color-bg-secondary)]/60 pl-7 pr-2 text-[11px] text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent/55"
                />
              </label>
            </div>
            )}

            <div className="overflow-y-auto p-1.5">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-xs text-dim text-center">{emptyMessage}</div>
              ) : (
                filteredItems.map((item) => {
                  const active = selected.has(item.value);
                  return (
                    <div key={item.value} className="flex items-center gap-1 rounded-md hover:bg-tertiary px-1">
                      <button
                        type="button"
                        onClick={() => onToggle(item.value)}
                        className={`flex-1 text-left px-1.5 py-2 text-xs rounded-md transition-colors ${
                          active ? 'text-accent' : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate ${item.toneClass ?? ''}`}
                            style={item.toneColor ? { color: item.toneColor } : undefined}
                          >
                            {item.label}
                          </span>
                          {active && <Check size={12} className="text-accent shrink-0" />}
                        </div>
                        {item.description && (
                          <div className="text-[10px] text-dim mt-0.5 truncate">{item.description}</div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOnly(item.value);
                          setTimeout(() => setOpen(false), 0);
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        <Crosshair size={10} />
                        only
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

interface CompactFilterPanelProps {
  selectedProjectId?: string;
  projectFilterItems: FilterOptionItem[];
  showStatusFilter: boolean;
  statusFilter: Set<string>;
  statusFilterItems: FilterOptionItem[];
  statusFilterOrder: string[];
  priorityFilter: Set<string>;
  priorityFilterItems: FilterOptionItem[];
  priorityFilterOrder: string[];
  typeFilter: Set<string>;
  typeFilterItems: FilterOptionItem[];
  typeFilterOrder: string[];
  labelFilter: Set<string>;
  labelFilterItems: FilterOptionItem[];
  labelFilterOrder: string[];
  activeFilterCount: number;
  onSelectProject: (projectId: string) => void;
  onClearProject: () => void;
  onToggleMultiFilter: (param: string, value: string, current: Set<string>, orderedValues: string[]) => void;
  onResetAll: () => void;
}

function CompactFilterPanel({
  selectedProjectId,
  projectFilterItems,
  showStatusFilter,
  statusFilter,
  statusFilterItems,
  statusFilterOrder,
  priorityFilter,
  priorityFilterItems,
  priorityFilterOrder,
  typeFilter,
  typeFilterItems,
  typeFilterOrder,
  labelFilter,
  labelFilterItems,
  labelFilterOrder,
  activeFilterCount,
  onSelectProject,
  onClearProject,
  onToggleMultiFilter,
  onResetAll,
}: CompactFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    setMenuStyle(buildMenuStyle(triggerRef.current, 320));
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    const onEscape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    const onOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('keydown', onEscape);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('keydown', onEscape);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open, reposition]);

  const sections: {
    key: string;
    label: string;
    mode: 'single' | 'multi';
    items: FilterOptionItem[];
    selected: Set<string>;
    param: string;
    order: string[];
  }[] = [
    { key: 'project', label: 'PROJECT', mode: 'single', items: projectFilterItems, selected: new Set(selectedProjectId ? [selectedProjectId] : []), param: 'project', order: [] },
    ...(showStatusFilter && statusFilterItems.length > 0 ? [{ key: 'status', label: 'STATUS', mode: 'multi' as const, items: statusFilterItems, selected: statusFilter, param: DASHBOARD_STATUS_PARAM, order: statusFilterOrder }] : []),
    ...(priorityFilterItems.length > 0 ? [{ key: 'priority', label: 'PRIORITY', mode: 'multi' as const, items: priorityFilterItems, selected: priorityFilter, param: DASHBOARD_PRIORITY_PARAM, order: priorityFilterOrder }] : []),
    ...(typeFilterItems.length > 0 ? [{ key: 'type', label: 'TYPE', mode: 'multi' as const, items: typeFilterItems, selected: typeFilter, param: DASHBOARD_TYPE_PARAM, order: typeFilterOrder }] : []),
    ...(labelFilterItems.length > 0 ? [{ key: 'label', label: 'LABEL', mode: 'multi' as const, items: labelFilterItems, selected: labelFilter, param: DASHBOARD_LABEL_PARAM, order: labelFilterOrder }] : []),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors ${
          activeFilterCount > 0
            ? 'bg-accent/10 text-accent'
            : 'bg-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
      >
        <SlidersHorizontal size={12} />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-accent/20 text-accent text-[10px] font-medium px-1">
            {activeFilterCount}
          </span>
        )}
      </button>

      {open && menuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[1190] animate-fadeIn"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-elevated shadow-lg shadow-black/35 overflow-hidden flex flex-col animate-scaleIn"
          >
            <div className="px-3 py-2.5 bg-[var(--color-bg-secondary)]/45 flex items-center justify-between">
              <div className="text-xs font-medium">Filters</div>
              <button
                type="button"
                onClick={() => {
                  onResetAll();
                  setTimeout(() => setOpen(false), 0);
                }}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset all
              </button>
            </div>

            <div className="overflow-y-auto p-1.5 space-y-3">
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-dim">
                    {section.label}
                  </div>
                  {section.mode === 'single' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onClearProject();
                          setTimeout(() => setOpen(false), 0);
                        }}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                          !selectedProjectId ? 'text-accent' : 'text-[var(--color-text-primary)] hover:bg-tertiary'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">All projects</span>
                          {!selectedProjectId && <Check size={12} className="text-accent shrink-0" />}
                        </div>
                      </button>
                      {section.items.map((item) => {
                        const active = item.value === selectedProjectId;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              onSelectProject(item.value);
                              setTimeout(() => setOpen(false), 0);
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                              active ? 'text-accent' : 'text-[var(--color-text-primary)] hover:bg-tertiary'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{item.label}</span>
                              {active && <Check size={12} className="text-accent shrink-0" />}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    section.items.map((item) => {
                      const active = section.selected.has(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => onToggleMultiFilter(section.param, item.value, section.selected, section.order)}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors hover:bg-tertiary ${
                            active ? 'text-accent' : 'text-[var(--color-text-primary)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`truncate ${item.toneClass ?? ''}`}
                              style={item.toneColor ? { color: item.toneColor } : undefined}
                            >
                              {item.label}
                            </span>
                            {active && <Check size={12} className="text-accent shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  onOpenTask: (taskId: string) => void;
  canCreateTask: boolean;
  onCreateTask: () => void;
}

function TaskListView({
  tasks,
  loading,
  selectedProjectId,
  getProjectName,
  onOpenTask,
  canCreateTask,
  onCreateTask,
}: TaskListViewProps) {
  const isMobile = useMobile();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-dim">Loading...</div>
    );
  }

  return (
    <div className="px-3 py-3 h-full overflow-y-auto">
      <Card padding="none" className="h-full min-h-0 flex flex-col">
        <div className="px-3 py-2.5 text-[11px] text-dim flex items-center justify-between bg-[var(--color-bg-secondary)]/65">
          <span>{tasks.length} tasks</span>
          <Button variant="ghost" size="xs" icon={<Plus size={12} />} onClick={onCreateTask} disabled={!canCreateTask}>
            New task
          </Button>
        </div>
        {tasks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-dim">
            No tasks match the current filters.
          </div>
        ) : isMobile ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
            {tasks.map((task) => {
              const statusMeta = COLUMNS.find((column) => column.id === task.status);
              const statusLabel = statusMeta?.title ?? task.status;
              const statusColor = statusMeta?.color ?? 'text-dim';
              const touchedAt = task.completedAt ?? task.startedAt ?? task.createdAt;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="w-full rounded-xl bg-[var(--color-bg-secondary)]/70 px-3 py-2.5 text-left hover:bg-[var(--color-accent-glow)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
                      {task.pinned && <Pin size={11} className="text-[var(--color-warning)]" />}
                      <span className="truncate">{task.title}</span>
                    </div>
                    <span className={`text-[11px] font-medium shrink-0 ${statusColor}`}>{statusLabel}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-dim flex items-center justify-between gap-2">
                    <span className="truncate">{selectedProjectId ? 'Current project' : getProjectName(task.projectId)}</span>
                    <span>{relativeTime(touchedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-2">
            <div className="grid grid-cols-[minmax(280px,2.2fr)_minmax(140px,1fr)_minmax(120px,0.9fr)_minmax(110px,0.8fr)_minmax(90px,0.7fr)] px-3 pb-2 text-[10px] uppercase tracking-wide text-dim">
              <span className="pl-2">Task</span>
              <span>Project</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Updated</span>
            </div>
            <div className="space-y-1.5">
              {tasks.map((task) => {
                const statusMeta = COLUMNS.find((column) => column.id === task.status);
                const statusLabel = statusMeta?.title ?? task.status;
                const statusColor = statusMeta?.color ?? 'text-dim';
                const touchedAt = task.completedAt ?? task.startedAt ?? task.createdAt;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    className="w-full grid grid-cols-[minmax(280px,2.2fr)_minmax(140px,1fr)_minmax(120px,0.9fr)_minmax(110px,0.8fr)_minmax(90px,0.7fr)] items-center gap-2 rounded-xl bg-[var(--color-bg-secondary)]/60 px-3 py-3 text-left hover:bg-[var(--color-accent-glow)] transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--color-text-primary)] flex items-center gap-1.5">
                          {task.pinned && <Pin size={11} className="text-[var(--color-warning)]" />}
                          <span className="truncate">{task.title}</span>
                        </div>
                        {task.labels.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 pl-0.5">
                            {task.labels.slice(0, 2).map((label) => (
                              <span
                                key={label.id}
                                className="text-[9px] px-1.5 py-px rounded-full font-medium leading-tight"
                                style={{
                                  backgroundColor: `${label.color}22`,
                                  color: label.color,
                                }}
                              >
                                {label.name}
                              </span>
                            ))}
                            {task.labels.length > 2 && <span className="text-[9px] text-dim">+{task.labels.length - 2}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-dim truncate">{selectedProjectId ? 'Current project' : getProjectName(task.projectId)}</span>
                    <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
                    <span className="text-xs text-dim">{task.priority ? (PRIORITY_LABELS[task.priority] || task.priority) : '-'}</span>
                    <span className="text-xs text-dim">{relativeTime(touchedAt)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return (
    <div className="animate-drop-expand" style={{ height }}>
      <div className="h-full rounded-lg bg-accent/[0.07] flex items-center justify-center">
        <div className="w-8 h-[2px] rounded-full bg-accent/30" />
      </div>
    </div>
  );
}

interface NewTaskPlaceholderProps {
  focused?: boolean;
  selected?: boolean;
  showOnHover?: boolean;
  onClick: () => void;
}

function NewTaskPlaceholder({ focused, selected, showOnHover, onClick }: NewTaskPlaceholderProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  const visible = !!focused || !!selected;
  const containerClass = showOnHover
    ? visible
      ? 'max-h-16 opacity-100 translate-y-0 mt-2'
      : 'max-h-0 opacity-0 -translate-y-1 mt-0 pointer-events-none group-hover:max-h-16 group-hover:opacity-100 group-hover:translate-y-0 group-hover:mt-2 group-hover:pointer-events-auto'
    : visible
      ? 'max-h-16 opacity-100 translate-y-0 mt-2'
      : 'max-h-0 opacity-0 -translate-y-1 mt-0 pointer-events-none';

  return (
    <div className={`overflow-hidden transition-all duration-150 ease-out ${containerClass}`}>
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        icon={<Plus size={12} />}
        onClick={onClick}
        className={`w-full justify-center py-3 h-auto border rounded-md ${
          focused
            ? 'border-accent !text-accent !bg-[var(--color-accent-glow)]'
            : 'border-subtle !bg-tertiary hover:border-[var(--color-text-dim)] hover:!bg-secondary'
        }`}
      >
        New task
      </Button>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  projectName?: string;
  isMobile?: boolean;
  onLongPress?: (x: number, y: number) => void;
  focused?: boolean;
  ghost?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: '#f97316',
  medium: '#eab308',
  low: 'var(--color-text-dim)',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, projectName, isMobile, onLongPress, focused, ghost, onMouseDown },
  ref,
) {
  const navigate = useNavigate();
  const internalRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  // Merge refs
  const setRef = useCallback((el: HTMLDivElement | null) => {
    (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [ref]);

  const handleClick = () => {
    navigate(`/tasks/${task.id}`);
  };

  const longPressHandlers = useLongPress({
    onLongPress: () => {
      if (onLongPress) {
        const rect = document.getElementById(`task-${task.id}`)?.getBoundingClientRect();
        if (rect) {
          onLongPress(rect.left, rect.bottom);
        }
      }
    },
    onClick: handleClick,
    delay: 500,
  });

  // Scroll focused card into view
  useEffect(() => {
    if (focused && internalRef.current) {
      internalRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  // Clean up hover timer on unmount
  useEffect(() => {
    return () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (isMobile || ghost) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      setTooltip({ x: rect.right + 8, y: rect.top });
    }, 800);
  }, [isMobile, ghost]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setTooltip(null);
  }, []);

  // Suppress tooltip on mousedown (drag start)
  const wrappedMouseDown = useCallback((e: React.MouseEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setTooltip(null);
    onMouseDown?.(e);
  }, [onMouseDown]);

  const hasMeta = !!(projectName || task.priority || (task.taskType && task.taskType !== 'task'));
  const hasCode = !!(task.branch || task.prUrl || (task.diffStats && (task.diffStats.additions > 0 || task.diffStats.deletions > 0)));
  const hasLabels = !!(task.labels && task.labels.length > 0);
  const priorityColor = task.priority ? (PRIORITY_COLORS[task.priority] || 'var(--color-text-dim)') : undefined;

  return (
    <>
      <div
        ref={setRef}
        id={`task-${task.id}`}
        {...(isMobile ? longPressHandlers : {})}
        onMouseDown={!isMobile ? wrappedMouseDown : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={[
          'relative rounded-lg px-2.5 py-2 cursor-pointer select-none',
          ghost ? 'drag-ghost' : 'transition-all',
          focused
            ? 'bg-[var(--color-accent-glow)] ring-1 ring-accent/50'
            : ghost ? '' : 'hover:bg-[var(--color-bg-tertiary)]',
        ].join(' ')}
      >
        {/* Priority accent bar */}
        {priorityColor && (
          <div
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
            style={{ backgroundColor: priorityColor }}
          />
        )}

        {/* Pinned indicator */}
        {task.pinned && (
          <Pin size={10} className="absolute top-2 right-2 text-[var(--color-warning)] opacity-70" />
        )}

        {/* Title */}
        <h4 className={`text-[13px] font-medium leading-snug ${priorityColor ? 'pl-1.5' : ''}`}>
          {task.title}
        </h4>

        {/* Metadata row: project, type, priority label */}
        {hasMeta && (
          <div className={`flex items-center gap-1.5 mt-1 ${priorityColor ? 'pl-1.5' : ''}`}>
            {projectName && (
              <span className="text-[11px] text-accent truncate max-w-[120px]">{projectName}</span>
            )}
            {projectName && (task.priority || (task.taskType && task.taskType !== 'task')) && (
              <span className="text-dim text-[10px]">&middot;</span>
            )}
            {task.taskType && task.taskType !== 'task' && (
              <span className="text-[10px] text-dim capitalize">{task.taskType}</span>
            )}
            {task.priority && (
              <span
                className="text-[10px] font-semibold"
                style={{ color: priorityColor }}
              >
                {PRIORITY_LABELS[task.priority] || task.priority}
              </span>
            )}
          </div>
        )}

        {/* Code metadata row: branch, diff stats, PR */}
        {hasCode && (
          <div className={`flex items-center gap-2 mt-1 ${priorityColor ? 'pl-1.5' : ''}`}>
            {task.branch && (
              <span className="text-[10px] text-dim font-mono flex items-center gap-0.5 truncate max-w-[140px]">
                <GitBranch size={10} className="flex-shrink-0 opacity-60" />
                {task.branch}
              </span>
            )}
            {task.diffStats && (task.diffStats.additions > 0 || task.diffStats.deletions > 0) && (
              <span className="text-[10px] font-mono flex items-center gap-0.5">
                {task.diffStats.additions > 0 && (
                  <span className="text-[var(--color-success)]">+{task.diffStats.additions}</span>
                )}
                {task.diffStats.deletions > 0 && (
                  <span className="text-[var(--color-error)]">-{task.diffStats.deletions}</span>
                )}
              </span>
            )}
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-[10px] font-mono text-accent hover:underline inline-flex items-center gap-0.5 flex-shrink-0"
              >
                <GitPullRequest size={10} />
                PR
              </a>
            )}
          </div>
        )}

        {/* Labels */}
        {hasLabels && (
          <div className={`flex flex-wrap gap-1 mt-1.5 ${priorityColor ? 'pl-1.5' : ''}`}>
            {task.labels.slice(0, 3).map(label => (
              <span
                key={label.id}
                className="text-[9px] px-1.5 py-px rounded-full font-medium leading-tight"
                style={{
                  backgroundColor: label.color + '22',
                  color: label.color,
                }}
              >
                {label.name}
              </span>
            ))}
            {task.labels.length > 3 && (
              <span className="text-[9px] text-dim">+{task.labels.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Hover tooltip (portal) */}
      {tooltip && <TaskTooltip task={task} projectName={projectName} x={tooltip.x} y={tooltip.y} />}
    </>
  );
});

// --- Delayed hover tooltip ---

function TaskTooltip({ task, projectName, x, y }: { task: Task; projectName?: string; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - 12) {
      nx = x - rect.width - 16; // flip to left side of card
    }
    if (ny + rect.height > window.innerHeight - 12) {
      ny = window.innerHeight - rect.height - 12;
    }
    if (ny < 12) ny = 12;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  const hasDescription = !!task.description;
  const hasBranch = !!task.branch;
  const hasPR = !!task.prUrl;
  const hasTimestamps = !!(task.createdAt || task.startedAt || task.completedAt);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] bg-elevated border border-subtle rounded-lg shadow-lg max-w-xs w-72 text-xs animate-fadeIn pointer-events-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2">
        {projectName && (
          <span className="text-[10px] text-accent block mb-0.5">{projectName}</span>
        )}
        <div className="font-medium text-[13px] text-[var(--color-text-primary)] leading-snug">{task.title}</div>
      </div>

      {/* Description */}
      {hasDescription && (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed line-clamp-4 whitespace-pre-wrap">
            {task.description}
          </p>
        </div>
      )}

      {/* Details section */}
      {(hasBranch || hasPR || hasTimestamps) && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-subtle/50 pt-2">
          {hasBranch && (
            <div className="flex items-center gap-1.5 text-dim">
              <GitBranch size={10} className="flex-shrink-0 opacity-60" />
              <span className="font-mono text-[10px] truncate">{task.branch}</span>
            </div>
          )}
          {hasPR && (
            <div className="flex items-center gap-1.5 text-accent">
              <GitPullRequest size={10} className="flex-shrink-0" />
              <span className="text-[10px]">Pull request open</span>
            </div>
          )}
          {task.createdAt && (
            <div className="flex items-center gap-1.5 text-dim">
              <Calendar size={10} className="flex-shrink-0 opacity-60" />
              <span className="text-[10px]">Created {relativeTime(task.createdAt)}</span>
            </div>
          )}
          {task.startedAt && (
            <div className="flex items-center gap-1.5 text-dim">
              <Clock size={10} className="flex-shrink-0 opacity-60" />
              <span className="text-[10px]">Started {relativeTime(task.startedAt)}</span>
            </div>
          )}
          {task.completedAt && (
            <div className="flex items-center gap-1.5 text-[var(--color-success)]">
              <CheckCircle2 size={10} className="flex-shrink-0" />
              <span className="text-[10px]">Completed {relativeTime(task.completedAt)}</span>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

interface TaskContextMenuProps {
  x: number;
  y: number;
  taskId: string;
  currentStatus: TaskStatus;
  onClose: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

function TaskContextMenu({ x, y, currentStatus, onClose, onStatusChange }: TaskContextMenuProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const menuStyle = {
    left: Math.min(x, window.innerWidth - 160),
    top: Math.min(y, window.innerHeight - 200),
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
      />
      <div
        className="fixed z-50 bg-elevated border border-subtle rounded-lg shadow-lg min-w-[150px]"
        style={menuStyle}
      >
        <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-dim">
          Move to
        </div>
        {COLUMNS.map((column) => {
          const MenuIcon = COLUMN_ICONS[column.id];
          return (
            <button
              key={column.id}
              onClick={() => onStatusChange(column.id)}
              disabled={column.id === currentStatus}
              className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                column.id === currentStatus
                  ? 'text-dim cursor-not-allowed'
                  : `${column.color} hover:bg-tertiary`
              }`}
            >
              <MenuIcon size={14} />
              {column.title}
              {column.id === currentStatus && (
                <span className="ml-1 text-xs">(current)</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface WorkflowPromptModalProps {
  taskId: string;
  onClose: () => void;
}

function WorkflowPromptModal({ taskId, onClose }: WorkflowPromptModalProps) {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const startMutation = useMutation({
    mutationFn: () => sessionsApi.start(taskId, { provider, prompt: prompt || undefined }),
    onSuccess: () => {
      onClose();
      navigate(`/tasks/${taskId}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    },
  });

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-md">
        <div className="px-4 py-3">
          <h2 className="text-sm font-medium">Start Agent Session</h2>
        </div>
        <div className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-2">Provider</label>
            <div className="flex gap-2">
              {(['claude', 'codex'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex-1 py-2 px-4 border rounded-md text-sm transition-colors ${
                    provider === p
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-subtle text-dim hover:bg-tertiary'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">Prompt (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] resize-none"
              placeholder="describe what the agent should do..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
              className="flex-1"
            >
              Skip
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              loading={startMutation.isPending}
              className="flex-1"
            >
              {startMutation.isPending ? 'Starting...' : 'Start'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
