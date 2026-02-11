import { useState, useMemo, useEffect, useRef, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Pin, GitPullRequest, Funnel, X, Plus, Inbox, Play, Eye, CheckCircle2 } from 'lucide-react';
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

export function Dashboard({ panelOpen = false }: DashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = searchParams.get('project') || undefined;

  // Restore project filter from sessionStorage on mount
  useEffect(() => {
    if (!searchParams.get('project')) {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        setSearchParams({ project: stored }, { replace: true });
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
  const [showCreateProject, setShowCreateProject] = useState(false);
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

  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) {
      map.set(col.id, []);
    }
    for (const t of tasks ?? []) {
      const list = map.get(t.status);
      if (list) list.push(t);
    }
    return map;
  }, [tasks]);

  const getTasksByStatus = (status: TaskStatus): Task[] => {
    return tasksByStatus.get(status) ?? [];
  };

  const getProjectName = (projectId: string): string => {
    return projects?.find((p) => p.id === projectId)?.name ?? 'unknown';
  };

  const activeProjectName = selectedProjectId ? getProjectName(selectedProjectId) : null;

  useSetHeader(
    selectedProjectId ? (
      <div className="flex items-center justify-between w-full">
        <div className="inline-flex items-center gap-2 text-xs text-dim">
          <Funnel size={12} />
          <span>
            Dashboard filter: <span className="text-[var(--color-text-primary)]">{activeProjectName}</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          icon={<X size={12} />}
          onClick={() => {
            sessionStorage.removeItem(SESSION_KEY);
            navigate('/');
          }}
          title="Clear project filter"
        >
          Clear
        </Button>
      </div>
    ) : null,
    `dashboard-${selectedProjectId ?? 'none'}`,
  );

  const hasProjects = projects && projects.length > 0;

  const navigateToCreate = useCallback((status?: TaskStatus) => {
    const params = new URLSearchParams();
    if (selectedProjectId) params.set('project', selectedProjectId);
    if (status && status !== TASK_STATUS.BACKLOG) params.set('status', status);
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

  // Auto-select first task on initial load or when project filter changes
  const prevProjectId = useRef(selectedProjectId);
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!tasks) return;
    const projectChanged = prevProjectId.current !== selectedProjectId;
    prevProjectId.current = selectedProjectId;
    if (hasInitialized.current && !projectChanged) return;
    hasInitialized.current = true;
    for (let col = 0; col < COLUMNS.length; col++) {
      const colTasks = tasksByStatus.get(COLUMNS[col].id) ?? [];
      if (colTasks.length > 0) {
        setFocus({ col, card: 0 });
        return;
      }
    }
    setFocus({ col: 0, card: 0 });
  }, [selectedProjectId, tasks, tasksByStatus]);

  const STATUS_ORDER: TaskStatus[] = COLUMNS.map((c) => c.id);

  const getMaxCard = useCallback(
    (colIdx: number): number => getColumnTasks(colIdx).length,
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
        } else if (hasProjects) {
          navigateToCreate(COLUMNS[focus.col].id);
        }
      },
      Escape: () => setFocus(null),
      'Shift+ArrowLeft': moveColumnLeft,
      'Shift+ArrowRight': moveColumnRight,
      'Shift+H': moveColumnLeft,
      'Shift+L': moveColumnRight,
      'Shift+ArrowUp': reorderUp,
      'Shift+ArrowDown': reorderDown,
      'Shift+K': reorderUp,
      'Shift+J': reorderDown,
      x: togglePin,
      n: () => {
        if (hasProjects) {
          navigateToCreate(COLUMNS[focus?.col ?? 0].id);
        }
      },
      p: () => setShowCreateProject(true),
      '1': () => setFocus({ col: 0, card: 0 }),
      '2': () => setFocus({ col: 1, card: 0 }),
      '3': () => setFocus({ col: 2, card: 0 }),
      '4': () => setFocus({ col: 3, card: 0 }),
      '?': () => setShowHelp(true),
    },
    enabled: !panelOpen && !showCreateProject && !showHelp && !contextMenu && !drag && !sidebarFocused,
  });

  // Sync mobile tab to focus column
  useEffect(() => {
    if (focus && isMobile) {
      setActiveColumnIndex(focus.col);
    }
  }, [focus, isMobile]);

  // --- Custom drag-and-drop (desktop only) ---

  const handleMouseDown = useCallback((e: React.MouseEvent, task: Task, colIdx: number, cardIdx: number) => {
    if (isMobile || e.button !== 0) return;
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
  }, [isMobile]);

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
    if (!drag) return;

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
  }, [drag, calcDropTarget, tasks, navigate, getColumnTasks, updateTaskMutation]);

  // Is dragging (mouse has moved enough)?
  const isDragging = drag && Math.hypot(drag.mouseX - drag.initialMouseX, drag.mouseY - drag.initialMouseY) >= 5;

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

      {/* Kanban Board */}
      {isMobile ? (
        // Mobile: Tabbed columns with swipe navigation
        <div className="flex flex-col h-full">
          {/* Tab Navigation */}
          <div className="flex border-b border-subtle bg-secondary overflow-x-auto">
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
                <NewTaskPlaceholder
                  focused={focus?.col === activeColumnIndex && focus?.card === getTasksByStatus(COLUMNS[activeColumnIndex].id).length}
                  onClick={() => { if (hasProjects) navigateToCreate(COLUMNS[activeColumnIndex].id); }}
                />
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
                  className={`group flex-1 min-w-0 flex flex-col transition-colors ${
                    focus?.col === colIdx
                      ? '!border-accent'
                      : ''
                  }`}
                >
                  <div ref={(el) => { columnRefs.current[colIdx] = el; }} className="flex flex-col h-full">
                  {/* Column Header */}
                  <div className="px-4 py-3 border-b border-subtle">
                    <div className="flex items-center justify-between">
                      <h3 className={`text-xs font-medium uppercase tracking-wider ${column.color} flex items-center gap-1.5`}>
                        <ColIcon size={14} className="text-dim" />
                        {column.title}
                      </h3>
                      <Badge variant="count">{colTasks.length}</Badge>
                    </div>
                  </div>

                  {/* Tasks */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {tasksLoading ? (
                      <div className="text-center text-dim py-4 text-sm">
                        Loading...
                      </div>
                    ) : (
                      <>
                        {colTasks.map((task, cardIdx) => {
                          const isGhost = !!(isDragging && drag?.taskId === task.id);
                          const showDropPlaceholder = isDragging && drag?.targetCol === colIdx && drag?.targetPosition === cardIdx && drag?.taskId !== task.id;
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
                        {/* Drop placeholder at end of column */}
                        {isDragging && drag?.targetCol === colIdx && drag?.targetPosition >= colTasks.length && (
                          <DropPlaceholder height={drag!.cardHeight} />
                        )}
                        <NewTaskPlaceholder
                          focused={focus?.col === colIdx && focus?.card === colTasks.length}
                          selected={focus?.col === colIdx}
                          showOnHover
                          onClick={() => { if (hasProjects) navigateToCreate(column.id); }}
                        />
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

      {/* Drag overlay (portal) */}
      {isDragging && drag && (() => {
        const draggedTask = (tasks ?? []).find((t) => t.id === drag.taskId);
        if (!draggedTask) return null;
        return createPortal(
          <div
            className="fixed z-[100] pointer-events-none"
            style={{
              left: drag.mouseX - drag.cardOffsetX,
              top: drag.mouseY - drag.cardOffsetY,
              width: drag.cardWidth,
              transform: 'rotate(2deg)',
              opacity: 0.9,
            }}
          >
            <TaskCard
              task={draggedTask}
              projectName={!selectedProjectId ? getProjectName(draggedTask.projectId) : undefined}
              focused={false}
            />
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

function DropPlaceholder({ height }: { height: number }) {
  return (
    <div
      className="border-2 border-dashed border-accent bg-[var(--color-accent-glow)] rounded-md animate-drop-pulse mb-2"
      style={{ height }}
    />
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

const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, projectName, isMobile, onLongPress, focused, ghost, onMouseDown },
  ref,
) {
  const navigate = useNavigate();
  const internalRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={setRef}
      id={`task-${task.id}`}
      {...(isMobile ? longPressHandlers : {})}
      onMouseDown={!isMobile ? onMouseDown : undefined}
      className={`bg-inset rounded-lg border p-2 transition-all cursor-pointer select-none ${
        isMobile ? 'select-none' : ''
      } ${ghost ? 'opacity-20' : ''} ${focused ? 'border-accent bg-[var(--color-accent-glow)]' : 'border-subtle hover:border-[var(--color-text-dim)]'}`}
    >
      <h4 className="font-medium text-sm">
        {task.title}
      </h4>
      <div className="flex items-center flex-wrap gap-2 mt-2">
        {projectName && (
          <span className="text-xs text-accent">
            {projectName}
          </span>
        )}
        {task.taskType && task.taskType !== 'task' && (
          <span className="text-[10px] text-dim capitalize">
            {task.taskType}
          </span>
        )}
        {task.priority && (
          <PriorityDot priority={task.priority} />
        )}
        {task.branch && (
          <span className="text-xs text-dim font-mono flex items-center gap-1">
            <GitBranch size={12} className="flex-shrink-0" />
            {task.branch}
          </span>
        )}
        {task.pinned && (
          <span className="text-xs text-[var(--color-error)] flex items-center gap-0.5">
            <Pin size={10} />
            Pinned
          </span>
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
        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[10px] font-mono text-accent hover:underline inline-flex items-center gap-0.5"
          >
            <GitPullRequest size={10} />
            PR
          </a>
        )}
        {task.labels?.slice(0, 3).map(label => (
          <span
            key={label.id}
            className="text-[10px] px-1.5 py-px rounded-full text-white font-medium"
            style={{ backgroundColor: label.color }}
          >
            {label.name}
          </span>
        ))}
      </div>
    </div>
  );
});

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: '#f97316',
  medium: '#eab308',
  low: 'var(--color-text-dim)',
};

function PriorityDot({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] || 'var(--color-text-dim)';
  return (
    <span className="flex items-center gap-0.5 text-[10px]" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {priority}
    </span>
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
        <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-dim border-b border-subtle">
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
        <div className="px-4 py-3 border-b border-subtle">
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
