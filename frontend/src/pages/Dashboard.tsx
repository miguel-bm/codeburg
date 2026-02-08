import { useState, useMemo, useEffect, useRef, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { tasksApi, projectsApi, sessionsApi } from '../api';
import type { Task, TaskStatus, CreateTaskInput, UpdateTaskResponse } from '../api';
import { useMobile } from '../hooks/useMobile';
import { useSwipe } from '../hooks/useSwipe';
import { useLongPress } from '../hooks/useLongPress';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { HelpOverlay } from '../components/common/HelpOverlay';
import { CreateProjectModal } from '../components/common/CreateProjectModal';

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'backlog', title: 'BACKLOG', color: 'status-backlog' },
  { id: 'in_progress', title: 'IN_PROGRESS', color: 'status-in-progress' },
  { id: 'in_review', title: 'IN_REVIEW', color: 'status-in-review' },
  { id: 'done', title: 'DONE', color: 'status-done' },
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

export function Dashboard() {
  const [searchParams] = useSearchParams();
  const selectedProjectId = searchParams.get('project') || undefined;
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createTaskStatus, setCreateTaskStatus] = useState<TaskStatus>('backlog');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [focus, setFocus] = useState<{ col: number; card: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [workflowPrompt, setWorkflowPrompt] = useState<{ taskId: string } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useMobile();

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
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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

  const hasProjects = projects && projects.length > 0;

  const getColumnTasks = useCallback(
    (colIdx: number): Task[] => tasksByStatus.get(COLUMNS[colIdx]?.id) ?? [],
    [tasksByStatus],
  );

  const getFocusedTask = useCallback((): Task | null => {
    if (!focus) return null;
    const col = getColumnTasks(focus.col);
    return col[focus.card] ?? null;
  }, [focus, getColumnTasks]);

  // Auto-select first task on load or when filter changes
  useEffect(() => {
    if (!tasks) return;
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
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
  }, [focus, getFocusedTask, queryClient]);

  useKeyboardNav({
    keyMap: {
      ArrowLeft: () => setFocus((f) => {
        const col = Math.max((f?.col ?? 1) - 1, 0);
        return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
      }),
      h: () => setFocus((f) => {
        const col = Math.max((f?.col ?? 1) - 1, 0);
        return { col, card: Math.min(f?.card ?? 0, getMaxCard(col)) };
      }),
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
          setCreateTaskStatus(COLUMNS[focus.col].id);
          setShowCreateTask(true);
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
          setCreateTaskStatus(COLUMNS[focus?.col ?? 0].id);
          setShowCreateTask(true);
        }
      },
      p: () => setShowCreateProject(true),
      '1': () => setFocus({ col: 0, card: 0 }),
      '2': () => setFocus({ col: 1, card: 0 }),
      '3': () => setFocus({ col: 2, card: 0 }),
      '4': () => setFocus({ col: 3, card: 0 }),
      '?': () => setShowHelp(true),
    },
    enabled: !showCreateTask && !showCreateProject && !showHelp && !contextMenu && !drag,
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
    <Layout>
      {/* Kanban Board */}
      {isMobile ? (
        // Mobile: Tabbed columns with swipe navigation
        <div className="flex flex-col h-full">
          {/* Tab Navigation */}
          <div className="flex border-b border-subtle bg-secondary overflow-x-auto">
            {COLUMNS.map((column, index) => (
              <button
                key={column.id}
                onClick={() => setActiveColumnIndex(index)}
                className={`flex-1 min-w-0 px-3 py-2 text-xs font-medium transition-colors ${
                  activeColumnIndex === index
                    ? `${column.color} border-b-2 border-accent`
                    : 'text-dim hover:text-[var(--color-text-primary)]'
                }`}
              >
                {column.title.slice(0, 8)}
                <span className="ml-1 text-dim">
                  [{getTasksByStatus(column.id).length}]
                </span>
              </button>
            ))}
          </div>

          {/* Swipeable Content */}
          <div
            className="flex-1 overflow-y-auto p-4"
            {...swipeHandlers}
          >
            {tasksLoading ? (
              <div className="text-center text-dim py-8 text-sm">loading...</div>
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
                  onClick={() => { if (hasProjects) { setCreateTaskStatus(COLUMNS[activeColumnIndex].id); setShowCreateTask(true); } }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        // Desktop: Horizontal scrolling kanban with custom DnD
        <div className="p-6 h-full overflow-x-auto">
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((column, colIdx) => {
              const colTasks = getTasksByStatus(column.id);
              return (
                <div
                  key={column.id}
                  ref={(el) => { columnRefs.current[colIdx] = el; }}
                  className={`w-80 flex flex-col bg-secondary border transition-colors ${
                    focus?.col === colIdx
                      ? 'border-accent'
                      : 'border-subtle'
                  }`}
                >
                  {/* Column Header */}
                  <div className="px-4 py-3 border-b border-subtle">
                    <div className="flex items-center justify-between">
                      <h3 className={`text-sm font-medium ${column.color}`}>
                        {column.title}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-dim">
                          [{colTasks.length}]
                        </span>
                        {focus?.col === colIdx && (
                          <span className="text-[10px] text-dim opacity-40">[n]</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tasks */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {tasksLoading ? (
                      <div className="text-center text-dim py-4 text-sm">
                        loading...
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
                                colIdx={colIdx}
                                cardIdx={cardIdx}
                                totalCards={colTasks.length}
                                totalCols={COLUMNS.length}
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
                          onClick={() => { if (hasProjects) { setCreateTaskStatus(column.id); setShowCreateTask(true); } }}
                        />
                      </>
                    )}
                  </div>
                </div>
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
          currentStatus={tasks?.find((t) => t.id === contextMenu.taskId)?.status ?? 'backlog'}
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

      {/* Create Task Modal */}
      {showCreateTask && hasProjects && (
        <CreateTaskModal
          projects={projects!}
          defaultProjectId={selectedProjectId}
          defaultStatus={createTaskStatus}
          onClose={() => setShowCreateTask(false)}
        />
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
    </Layout>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return (
    <div
      className="border-2 border-dashed border-accent bg-[var(--color-accent-glow)] animate-drop-pulse mb-2"
      style={{ height }}
    />
  );
}

interface NewTaskPlaceholderProps {
  focused?: boolean;
  onClick: () => void;
}

function NewTaskPlaceholder({ focused, onClick }: NewTaskPlaceholderProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`p-3 border border-dashed text-center text-sm cursor-pointer transition-colors ${
        focused
          ? 'border-accent text-accent bg-[var(--color-accent-glow)]'
          : 'border-subtle text-dim hover:border-accent hover:text-accent'
      }`}
    >
      + new task
    </div>
  );
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: 'var(--color-status-backlog)',
  in_progress: 'var(--color-status-in-progress)',
  in_review: 'var(--color-status-in-review)',
  done: 'var(--color-status-done)',
};

interface TaskCardProps {
  task: Task;
  projectName?: string;
  isMobile?: boolean;
  onLongPress?: (x: number, y: number) => void;
  focused?: boolean;
  ghost?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  colIdx?: number;
  cardIdx?: number;
  totalCards?: number;
  totalCols?: number;
}

const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, projectName, isMobile, onLongPress, focused, ghost, onMouseDown, colIdx, cardIdx, totalCards, totalCols },
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

  const showHints = focused && !isMobile && colIdx !== undefined && cardIdx !== undefined;

  return (
    <div
      ref={setRef}
      id={`task-${task.id}`}
      {...(isMobile ? longPressHandlers : {})}
      onMouseDown={!isMobile ? onMouseDown : undefined}
      className={`bg-primary p-3 border-l-2 border transition-all cursor-pointer select-none ${
        isMobile ? 'select-none' : ''
      } ${ghost ? 'opacity-20' : ''} ${focused ? 'border-accent bg-[var(--color-accent-glow)]' : 'border-subtle hover:border-accent'}`}
      style={{ borderLeftColor: STATUS_COLORS[task.status] }}
    >
      <h4 className="font-medium text-sm">
        {task.title}
      </h4>
      {task.description && (
        <p className="text-xs text-dim mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center flex-wrap gap-2 mt-2">
        {projectName && (
          <span className="text-xs text-accent">
            {projectName}
          </span>
        )}
        {task.branch && (
          <span className="text-xs text-dim font-mono">
            [{task.branch}]
          </span>
        )}
        {task.pinned && (
          <span className="text-xs text-[var(--color-error)]">
            pinned
          </span>
        )}
      </div>
      {showHints && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] text-dim opacity-40">[&#9166;]</span>
          {colIdx! > 0 && <span className="text-[10px] text-dim opacity-40">[&#8679;&#8592;]</span>}
          {colIdx! < (totalCols ?? COLUMNS.length) - 1 && <span className="text-[10px] text-dim opacity-40">[&#8679;&#8594;]</span>}
          {cardIdx! > 0 && <span className="text-[10px] text-dim opacity-40">[&#8679;&#8593;]</span>}
          {cardIdx! < (totalCards ?? 0) - 1 && <span className="text-[10px] text-dim opacity-40">[&#8679;&#8595;]</span>}
        </div>
      )}
    </div>
  );
});

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
        className="fixed z-50 bg-secondary border border-subtle min-w-[150px]"
        style={menuStyle}
      >
        <div className="px-3 py-2 text-xs text-dim border-b border-subtle">
          // move_to
        </div>
        {COLUMNS.map((column) => (
          <button
            key={column.id}
            onClick={() => onStatusChange(column.id)}
            disabled={column.id === currentStatus}
            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
              column.id === currentStatus
                ? 'text-dim cursor-not-allowed'
                : `${column.color} hover:bg-tertiary`
            }`}
          >
            {column.title}
            {column.id === currentStatus && (
              <span className="ml-2 text-xs">(current)</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

interface CreateTaskModalProps {
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  defaultStatus?: TaskStatus;
  onClose: () => void;
}

function CreateTaskModal({ projects, defaultProjectId, defaultStatus = 'backlog', onClose }: CreateTaskModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const createMutation = useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: CreateTaskInput }) =>
      tasksApi.create(projectId, input),
    onSuccess: (task) => {
      if (defaultStatus !== 'backlog') {
        tasksApi.update(task.id, { status: defaultStatus }).then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    },
  });

  const canSubmit = title.trim().length > 0 && !createMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    createMutation.mutate({
      projectId,
      input: { title, description: description || undefined },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// new_task</h2>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-1">project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">title</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="implement feature x"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none resize-none"
              placeholder="optional description..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'creating...' : 'create'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// start_agent_session</h2>
        </div>
        <div className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-2">provider</label>
            <div className="flex gap-2">
              {(['claude', 'codex'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex-1 py-2 px-4 border text-sm transition-colors ${
                    provider === p
                      ? 'border-accent text-accent'
                      : 'border-subtle text-dim hover:border-accent hover:text-accent'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">prompt (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none resize-none"
              placeholder="describe what the agent should do..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              skip
            </button>
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              {startMutation.isPending ? 'starting...' : 'start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
