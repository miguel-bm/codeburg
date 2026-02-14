import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitBranch, Pin, GitPullRequest, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHoverTooltip } from '../../hooks/useHoverTooltip';
import { COLUMNS, COLUMN_ICONS, PRIORITY_COLORS, PRIORITY_LABELS } from '../../constants/tasks';
import { relativeTime } from '../../utils/text';
import { TaskTooltip } from './TaskCard';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import type { Task, TaskStatus } from '../../api';
import { TASK_STATUS } from '../../api';

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  movingTaskIds: Set<string>;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  onOpenTask: (taskId: string) => void;
  canCreateTask: boolean;
  onCreateTask: (status: TaskStatus) => void;
}

function groupTasksByStatus(tasks: Task[]): Map<TaskStatus, Task[]> {
  const map = new Map<TaskStatus, Task[]>();
  for (const col of COLUMNS) map.set(col.id, []);
  for (const task of tasks) {
    const list = map.get(task.status);
    if (list) list.push(task);
  }
  return map;
}

function ListRow({
  task,
  isMoving,
  selectedProjectId,
  getProjectName,
  onOpenTask,
}: {
  task: Task;
  isMoving?: boolean;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  onOpenTask: (taskId: string) => void;
}) {
  const { tooltip, handleMouseEnter, handleMouseLeave } = useHoverTooltip();

  const statusMeta = COLUMNS.find((c) => c.id === task.status);
  const statusColor = statusMeta?.color ?? 'text-dim';
  const priorityColor = task.priority ? (PRIORITY_COLORS[task.priority] || 'var(--color-text-dim)') : undefined;
  const hasCode = !!(task.branch || task.prUrl || (task.diffStats && (task.diffStats.additions > 0 || task.diffStats.deletions > 0)));
  const hasLabels = task.labels.length > 0;
  const touchedAt = task.completedAt ?? task.startedAt ?? task.createdAt;
  const projectName = selectedProjectId ? undefined : getProjectName(task.projectId);

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenTask(task.id)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer group text-left ${isMoving ? 'opacity-70' : 'hover:bg-[var(--color-bg-tertiary)]'}`}
      >
        {/* Priority accent bar */}
        {priorityColor && (
          <div
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
            style={{ backgroundColor: priorityColor }}
          />
        )}

        {/* Status dot */}
        <span className={`h-[6px] w-[6px] rounded-full flex-shrink-0 ${statusColor}`} />

        {/* Title + inline metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {task.pinned && <Pin size={11} className="text-[var(--color-warning)] flex-shrink-0" />}
            <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{task.title}</span>
          </div>
          {(hasLabels || hasCode) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {hasLabels && task.labels.slice(0, 2).map((label) => (
                <span
                  key={label.id}
                  className="text-[9px] px-1.5 py-px rounded-full font-medium leading-tight"
                  style={{ backgroundColor: `${label.color}22`, color: label.color }}
                >
                  {label.name}
                </span>
              ))}
              {task.labels.length > 2 && <span className="text-[9px] text-dim">+{task.labels.length - 2}</span>}
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
                  className="text-[10px] font-mono text-accent hover:underline inline-flex items-center gap-0.5 flex-shrink-0"
                >
                  <GitPullRequest size={10} />
                  PR
                </a>
              )}
            </div>
          )}
        </div>

        {/* Right side metadata */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {isMoving && (
            <span className="text-[10px] text-dim inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              Moving...
            </span>
          )}
          {projectName && (
            <span className="text-xs text-dim truncate max-w-[120px] hidden lg:block">{projectName}</span>
          )}
          {task.priority && (
            <span
              className="text-[10px] font-semibold"
              style={{ color: priorityColor }}
            >
              {PRIORITY_LABELS[task.priority] || task.priority}
            </span>
          )}
          <span className="text-[11px] text-dim w-[52px] text-right">{relativeTime(touchedAt)}</span>
        </div>
      </button>

      {tooltip && (
        <TaskTooltip
          task={task}
          projectName={projectName}
          x={tooltip.x}
          y={tooltip.y}
          anchorLeft={tooltip.anchorLeft}
          anchorRight={tooltip.anchorRight}
        />
      )}
    </>
  );
}

function MobileListRow({
  task,
  isMoving,
  selectedProjectId,
  getProjectName,
  onOpenTask,
}: {
  task: Task;
  isMoving?: boolean;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;
  onOpenTask: (taskId: string) => void;
}) {
  const statusMeta = COLUMNS.find((c) => c.id === task.status);
  const statusLabel = statusMeta?.title ?? task.status;
  const statusColor = statusMeta?.color ?? 'text-dim';
  const priorityColor = task.priority ? (PRIORITY_COLORS[task.priority] || 'var(--color-text-dim)') : undefined;
  const touchedAt = task.completedAt ?? task.startedAt ?? task.createdAt;
  const hasLabels = task.labels.length > 0;

  return (
    <button
      type="button"
      onClick={() => onOpenTask(task.id)}
      className={`relative w-full rounded-xl bg-[var(--color-bg-secondary)]/70 px-3 py-2.5 text-left transition-colors ${isMoving ? 'opacity-70' : 'hover:bg-[var(--color-accent-glow)]'}`}
    >
      {/* Priority accent bar */}
      {priorityColor && (
        <div
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          style={{ backgroundColor: priorityColor }}
        />
      )}

      {/* Top: pin + title + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-[var(--color-text-primary)] truncate flex items-center gap-1.5 min-w-0">
          {task.pinned && <Pin size={11} className="text-[var(--color-warning)] flex-shrink-0" />}
          <span className="truncate">{task.title}</span>
        </div>
        <span
          className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded-full ${statusColor}`}
          style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Middle: labels */}
      {hasLabels && (
        <div className="flex items-center gap-1 mt-1.5">
          {task.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="text-[9px] px-1.5 py-px rounded-full font-medium leading-tight"
              style={{ backgroundColor: `${label.color}22`, color: label.color }}
            >
              {label.name}
            </span>
          ))}
          {task.labels.length > 2 && <span className="text-[9px] text-dim">+{task.labels.length - 2}</span>}
        </div>
      )}

      {/* Bottom: project · priority · time */}
      <div className="mt-1 text-[11px] text-dim flex items-center gap-1.5">
        {isMoving && (
          <span className="text-[10px] inline-flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" />
            Moving...
          </span>
        )}
        <span className="truncate">{selectedProjectId ? 'Current project' : getProjectName(task.projectId)}</span>
        {task.priority && (
          <>
            <span>&middot;</span>
            <span className="font-semibold" style={{ color: priorityColor }}>{PRIORITY_LABELS[task.priority] || task.priority}</span>
          </>
        )}
        <span className="ml-auto flex-shrink-0">{relativeTime(touchedAt)}</span>
      </div>
    </button>
  );
}

export function TaskListView({
  tasks,
  loading,
  movingTaskIds,
  selectedProjectId,
  getProjectName,
  onOpenTask,
  canCreateTask,
  onCreateTask,
}: TaskListViewProps) {
  const isMobile = useMobile();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => groupTasksByStatus(tasks), [tasks]);

  const toggleSection = useCallback((status: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-dim">Loading...</div>
    );
  }

  return (
    <div className="pr-3 pb-3 h-full overflow-y-auto">
      <Card padding="none" className="h-full min-h-0 flex flex-col">
        {tasks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-dim">
            No tasks match the current filters.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {COLUMNS.map((col) => {
              const sectionTasks = grouped.get(col.id) ?? [];

              const StatusIcon = COLUMN_ICONS[col.id];
              const isCollapsed = collapsedSections.has(col.id);
              const canCreateInSection = canCreateTask && (col.id === TASK_STATUS.BACKLOG || col.id === TASK_STATUS.IN_PROGRESS);

              return (
                <div key={col.id}>
                  {/* Section header */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleSection(col.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 hover:bg-[var(--color-bg-tertiary)] rounded-md transition-colors"
                    >
                      <ChevronRight
                        size={12}
                        className={`text-dim transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                      />
                      <StatusIcon size={14} className={col.color} />
                      <span className={`text-[11px] uppercase tracking-wide font-medium ${col.color}`}>
                        {col.title}
                      </span>
                      <Badge variant="count" className="text-[10px] h-4 min-w-[1rem]">{sectionTasks.length}</Badge>
                    </button>
                    {canCreateInSection && (
                      <Button variant="ghost" size="xs" icon={<Plus size={12} />} onClick={() => onCreateTask(col.id)}>
                        New task
                      </Button>
                    )}
                  </div>

                  {/* Task rows */}
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className={`${isMobile ? 'space-y-2 py-1.5' : 'py-0.5'}`}>
                          {sectionTasks.map((task) =>
                            isMobile ? (
                              <MobileListRow
                                key={task.id}
                                task={task}
                                isMoving={movingTaskIds.has(task.id)}
                                selectedProjectId={selectedProjectId}
                                getProjectName={getProjectName}
                                onOpenTask={onOpenTask}
                              />
                            ) : (
                              <ListRow
                                key={task.id}
                                task={task}
                                isMoving={movingTaskIds.has(task.id)}
                                selectedProjectId={selectedProjectId}
                                getProjectName={getProjectName}
                                onOpenTask={onOpenTask}
                              />
                            ),
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
