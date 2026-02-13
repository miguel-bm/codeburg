import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { COLUMNS } from '../../constants/tasks';
import type { Task, TaskStatus } from '../../api';

export interface DashboardFocus {
  col: number;
  card: number;
}

interface UseDashboardFocusSyncParams {
  panelOpen: boolean;
  tasks: Task[] | undefined;
  tasksByStatus: Map<TaskStatus, Task[]>;
  selectedProjectId?: string;
  statusFilter: Set<TaskStatus>;
  priorityFilter: Set<string>;
  typeFilter: Set<string>;
  labelFilter: Set<string>;
  getColumnTasks: (colIdx: number) => Task[];
  navigateToPanel: (to: string, options?: { replace?: boolean }) => void;
  isMobile: boolean;
  setActiveColumnIndex: (index: number) => void;
}

type FocusUpdate =
  | DashboardFocus
  | null
  | ((prev: DashboardFocus | null) => DashboardFocus | null);

export function useDashboardFocusSync({
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
}: UseDashboardFocusSyncParams) {
  const [focus, dispatchFocus] = useReducer(
    (prev: DashboardFocus | null, next: FocusUpdate): DashboardFocus | null =>
      typeof next === 'function' ? next(prev) : next,
    null,
  );
  const setFocus = useCallback((next: FocusUpdate) => {
    dispatchFocus(next);
  }, []);

  const getFocusedTask = useCallback((): Task | null => {
    if (!focus) return null;
    const col = getColumnTasks(focus.col);
    return col[focus.card] ?? null;
  }, [focus, getColumnTasks]);

  const focusSelectionKey = useMemo(
    () => [
      selectedProjectId ?? '',
      Array.from(statusFilter).sort().join(','),
      Array.from(priorityFilter).sort().join(','),
      Array.from(typeFilter).sort().join(','),
      Array.from(labelFilter).sort().join(','),
    ].join('|'),
    [selectedProjectId, statusFilter, priorityFilter, typeFilter, labelFilter],
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
  }, [focusSelectionKey, tasks, tasksByStatus, setFocus]);

  const location = useLocation();
  const syncFromUrl = useRef(false);

  const getPanelTaskIdFromPath = useCallback((pathname: string): string | null => {
    const match = pathname.match(/^\/tasks\/([^/]+)$/);
    if (!match) return null;
    const taskId = match[1];
    if (taskId === 'new' || taskId === 'quick') return null;
    return taskId;
  }, []);

  useEffect(() => {
    if (!panelOpen || !tasks) return;
    const panelTaskId = getPanelTaskIdFromPath(location.pathname);
    if (!panelTaskId) return;

    for (let col = 0; col < COLUMNS.length; col++) {
      const colTasks = tasksByStatus.get(COLUMNS[col].id) ?? [];
      const cardIdx = colTasks.findIndex((task) => task.id === panelTaskId);
      if (cardIdx >= 0) {
        setFocus((prev) => {
          if (prev && prev.col === col && prev.card === cardIdx) return prev;
          syncFromUrl.current = true;
          return { col, card: cardIdx };
        });
        return;
      }
    }
  }, [location.pathname, panelOpen, tasks, tasksByStatus, getPanelTaskIdFromPath, setFocus]);

  const prevFocus = useRef(focus);
  useEffect(() => {
    if (!panelOpen || !focus) {
      prevFocus.current = focus;
      return;
    }

    const panelTaskId = getPanelTaskIdFromPath(location.pathname);
    if (!panelTaskId) {
      prevFocus.current = focus;
      return;
    }

    if (syncFromUrl.current) {
      syncFromUrl.current = false;
      prevFocus.current = focus;
      return;
    }

    const changed = !prevFocus.current
      || prevFocus.current.col !== focus.col
      || prevFocus.current.card !== focus.card;

    prevFocus.current = focus;
    if (!changed) return;

    const task = getColumnTasks(focus.col)[focus.card];
    if (task && task.id !== panelTaskId) {
      navigateToPanel(`/tasks/${task.id}`, { replace: true });
    }
  }, [focus, panelOpen, location.pathname, navigateToPanel, getColumnTasks, getPanelTaskIdFromPath]);

  useEffect(() => {
    if (focus && isMobile) {
      setActiveColumnIndex(focus.col);
    }
  }, [focus, isMobile, setActiveColumnIndex]);

  return {
    focus,
    setFocus,
    getFocusedTask,
  };
}
