import { type MouseEvent, type RefObject, useEffect, useRef } from 'react';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { COLUMNS, COLUMN_ICONS } from '../../constants/tasks';
import { DropPlaceholder, NewTaskPlaceholder, TaskCard } from './TaskCard';
import { TaskListView } from './TaskListView';
import type { Task, TaskStatus } from '../../api';
import type { DragState } from '../../hooks/useDragAndDrop';

interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

interface FocusState {
  col: number;
  card: number;
}

type DashboardView = 'kanban' | 'list';

interface DashboardBoardContentProps {
  view: DashboardView;
  listTasks: Task[];
  tasksLoading: boolean;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  onOpenTask: (taskId: string) => void;
  canCreateTask: boolean;
  onCreateTask: (status?: TaskStatus) => void;

  isMobile: boolean;
  activeColumnIndex: number;
  onSetActiveColumnIndex: (index: number) => void;
  getTasksByStatus: (status: TaskStatus) => Task[];
  focus: FocusState | null;
  onSetContextMenu: (menu: ContextMenuState) => void;
  onArchive: (taskId: string, archive: boolean) => void;
  canCreateTaskInStatus: (status: TaskStatus) => boolean;

  kanbanScrollRef: RefObject<HTMLDivElement | null>;
  columnRefs: RefObject<(HTMLDivElement | null)[]>;
  cardRefs: RefObject<Map<string, HTMLDivElement>>;
  isDragging: boolean;
  drag: DragState | null;
  onTaskMouseDown: (e: MouseEvent, task: Task, colIdx: number, cardIdx: number) => void;
}

export function DashboardBoardContent({
  view,
  listTasks,
  tasksLoading,
  selectedProjectId,
  getProjectName,
  onOpenTask,
  canCreateTask,
  onCreateTask,
  isMobile,
  activeColumnIndex,
  onSetActiveColumnIndex,
  getTasksByStatus,
  focus,
  onSetContextMenu,
  onArchive,
  canCreateTaskInStatus,
  kanbanScrollRef,
  columnRefs,
  cardRefs,
  isDragging,
  drag,
  onTaskMouseDown,
}: DashboardBoardContentProps) {
  if (view === 'list') {
    return (
      <TaskListView
        tasks={listTasks}
        loading={tasksLoading}
        selectedProjectId={selectedProjectId}
        getProjectName={getProjectName}
        onOpenTask={onOpenTask}
        canCreateTask={canCreateTask}
        onCreateTask={onCreateTask}
      />
    );
  }

  if (isMobile) {
    return (
      <MobileKanban
        activeColumnIndex={activeColumnIndex}
        onSetActiveColumnIndex={onSetActiveColumnIndex}
        getTasksByStatus={getTasksByStatus}
        tasksLoading={tasksLoading}
        selectedProjectId={selectedProjectId}
        getProjectName={getProjectName}
        focus={focus}
        onSetContextMenu={onSetContextMenu}
        onArchive={onArchive}
        canCreateTaskInStatus={canCreateTaskInStatus}
        onCreateTask={onCreateTask}
      />
    );
  }

  return (
    <div ref={kanbanScrollRef} className="pr-3 pb-3 h-full overflow-x-auto scrollbar-none">
      <div className="flex gap-2 h-full min-w-[1200px]">
        {COLUMNS.map((column, colIdx) => {
          const colTasks = getTasksByStatus(column.id);
          const ColIcon = COLUMN_ICONS[column.id];
          return (
            <Card
              key={column.id}
              padding="none"
              className={`group flex-1 min-w-0 flex flex-col transition-all duration-150 ${
                focus?.col === colIdx ? '!border-accent' : ''
              } ${isDragging && drag?.targetCol === colIdx ? 'drag-target-col' : ''}`}
            >
              <div ref={(el) => { columnRefs.current[colIdx] = el; }} className="flex flex-col h-full">
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-xs font-medium uppercase tracking-wider ${column.color} flex items-center gap-1.5`}>
                      <ColIcon size={14} className="text-dim" />
                      {column.title}
                    </h3>
                    <Badge variant="count">{colTasks.length}</Badge>
                  </div>
                </div>

                <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                  {tasksLoading ? (
                    <div className="text-center text-dim py-4 text-sm">Loading...</div>
                  ) : (
                    <>
                      {colTasks.map((task, cardIdx) => {
                        const isGhost = !!(isDragging && drag?.taskId === task.id);
                        const isReturnToOrigin = drag?.sourceCol === colIdx && drag?.sourceCard !== undefined && cardIdx === drag.sourceCard + 1;
                        const showDropPlaceholder = isDragging && drag?.targetCol === colIdx && drag?.targetPosition === cardIdx && drag?.taskId !== task.id && !isReturnToOrigin;
                        return (
                          <div key={task.id}>
                            {showDropPlaceholder && <DropPlaceholder height={drag!.cardHeight} />}
                            <TaskCard
                              ref={(el) => {
                                if (el) cardRefs.current.set(task.id, el);
                                else cardRefs.current.delete(task.id);
                              }}
                              task={task}
                              projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                              focused={!!(focus?.col === colIdx && focus?.card === cardIdx)}
                              ghost={isGhost}
                              onMouseDown={(e) => onTaskMouseDown(e, task, colIdx, cardIdx)}
                              onContextMenu={(x, y, taskId) => onSetContextMenu({ taskId, x, y })}
                              onArchive={onArchive}
                            />
                          </div>
                        );
                      })}
                      {isDragging && drag?.targetCol === colIdx && drag?.targetPosition >= colTasks.length
                        && !(drag?.sourceCol === colIdx && drag?.sourceCard === colTasks.length - 1) && (
                        <DropPlaceholder height={drag!.cardHeight} />
                      )}
                      {canCreateTaskInStatus(column.id) && (
                        <NewTaskPlaceholder
                          focused={focus?.col === colIdx && focus?.card === colTasks.length}
                          selected={focus?.col === colIdx}
                          showOnHover
                          onClick={() => onCreateTask(column.id)}
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
  );
}

/* ── Mobile Kanban with scroll-snap ──────────────────────────────── */

/** Short labels for tight mobile tabs */
const MOBILE_TITLES: Record<string, string> = {
  'In Progress': 'Active',
  'In Review': 'Review',
};

function MobileKanban({
  activeColumnIndex,
  onSetActiveColumnIndex,
  getTasksByStatus,
  tasksLoading,
  selectedProjectId,
  getProjectName,
  focus,
  onSetContextMenu,
  onArchive,
  canCreateTaskInStatus,
  onCreateTask,
}: {
  activeColumnIndex: number;
  onSetActiveColumnIndex: (index: number) => void;
  getTasksByStatus: (status: TaskStatus) => Task[];
  tasksLoading: boolean;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  focus: { col: number; card: number } | null;
  onSetContextMenu: (menu: { taskId: string; x: number; y: number }) => void;
  onArchive: (taskId: string, archive: boolean) => void;
  canCreateTaskInStatus: (status: TaskStatus) => boolean;
  onCreateTask: (status?: TaskStatus) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  // Scroll to active column when tab is tapped
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetLeft = activeColumnIndex * el.clientWidth;
    // Only scroll if not already at the right position (avoids fighting with snap)
    if (Math.abs(el.scrollLeft - targetLeft) > 2) {
      isScrolling.current = true;
      el.scrollTo({ left: targetLeft, behavior: 'auto' });
      // Clear flag after layout settles
      const timer = setTimeout(() => { isScrolling.current = false; }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeColumnIndex]);

  // Sync tab indicator when user scrolls (snap settles)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let rafId: number;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (isScrolling.current) return;
        const idx = Math.round(el.scrollLeft / el.clientWidth);
        if (idx >= 0 && idx < COLUMNS.length) {
          onSetActiveColumnIndex(idx);
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [onSetActiveColumnIndex]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex shrink-0">
        {COLUMNS.map((column, index) => {
          const TabIcon = COLUMN_ICONS[column.id];
          const isActive = activeColumnIndex === index;
          const label = MOBILE_TITLES[column.title] ?? column.title;
          return (
            <button
              key={column.id}
              onClick={() => onSetActiveColumnIndex(index)}
              className={`flex-1 min-w-0 px-2 py-2 text-[11px] font-medium transition-colors inline-flex items-center justify-center gap-1 border-b-2 ${
                isActive
                  ? `${column.color} border-accent`
                  : 'text-dim border-transparent'
              }`}
            >
              <TabIcon size={12} className="shrink-0" />
              <span className="truncate">{label}</span>
              <span className="text-dim shrink-0">{getTasksByStatus(column.id).length}</span>
            </button>
          );
        })}
      </div>

      {/* Scroll-snap content area */}
      <div
        ref={scrollRef}
        className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-none"
      >
        {COLUMNS.map((column, colIdx) => (
          <div
            key={column.id}
            className="w-full shrink-0 snap-start snap-always overflow-y-auto p-2"
          >
            {tasksLoading ? (
              <div className="text-center text-dim py-8 text-sm">Loading...</div>
            ) : (
              <div className="space-y-3">
                {getTasksByStatus(column.id).map((task, cardIdx) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                    isMobile
                    onLongPress={(x, y) => onSetContextMenu({ taskId: task.id, x, y })}
                    focused={focus?.col === colIdx && focus?.card === cardIdx}
                    onArchive={onArchive}
                  />
                ))}
                {canCreateTaskInStatus(column.id) && (
                  <NewTaskPlaceholder
                    focused={focus?.col === colIdx && focus?.card === getTasksByStatus(column.id).length}
                    onClick={() => onCreateTask(column.id)}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
