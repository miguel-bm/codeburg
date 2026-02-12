import { useState, useEffect, useCallback, useRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Pin, GitPullRequest, Calendar, Clock, CheckCircle2, Plus, Archive, ArchiveRestore } from 'lucide-react';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { useLongPress } from '../../hooks/useLongPress';
import { useHoverTooltip } from '../../hooks/useHoverTooltip';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../constants/tasks';
import { relativeTime } from '../../utils/text';
import { Button } from '../ui/Button';
import type { Task } from '../../api';

export function DropPlaceholder({ height }: { height: number }) {
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

export function NewTaskPlaceholder({ focused, selected, showOnHover, onClick }: NewTaskPlaceholderProps) {
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
      : 'max-h-16 opacity-100 translate-y-0 mt-2';

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
  onContextMenu?: (x: number, y: number, taskId: string) => void;
  focused?: boolean;
  ghost?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onArchive?: (taskId: string, archive: boolean) => void;
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, projectName, isMobile, onLongPress, onContextMenu, focused, ghost, onMouseDown, onArchive },
  ref,
) {
  const { navigateToPanel } = usePanelNavigation();
  const internalRef = useRef<HTMLDivElement>(null);
  const { tooltip, handleMouseEnter, handleMouseLeave, dismiss: dismissTooltip } = useHoverTooltip({
    disabled: !!isMobile || !!ghost,
  });

  // Merge refs
  const setRef = useCallback((el: HTMLDivElement | null) => {
    (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [ref]);

  const handleClick = () => {
    navigateToPanel(`/tasks/${task.id}`);
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

  // Suppress tooltip on mousedown (drag start)
  const wrappedMouseDown = useCallback((e: React.MouseEvent) => {
    dismissTooltip();
    onMouseDown?.(e);
  }, [onMouseDown, dismissTooltip]);

  const isArchived = !!task.archivedAt;
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
        onContextMenu={onContextMenu ? (e) => {
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY, task.id);
        } : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={[
          'group/card relative rounded-lg px-2.5 py-2 cursor-pointer select-none',
          ghost ? 'drag-ghost' : 'transition-all',
          focused
            ? 'bg-[var(--color-accent-glow)] ring-1 ring-accent/50'
            : ghost ? '' : 'hover:bg-[var(--color-bg-tertiary)]',
          isArchived ? 'opacity-50' : '',
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

        {/* Archive button (hover-only, done/archived tasks) */}
        {onArchive && (task.status === 'done' || isArchived) && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onArchive(task.id, !isArchived); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-1.5 right-1.5 p-1 rounded text-dim opacity-0 group-hover/card:opacity-100 hover:!text-accent hover:bg-accent/10 transition-all"
            title={isArchived ? 'Unarchive' : 'Archive'}
          >
            {isArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
          </button>
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

export function TaskTooltip({ task, projectName, x, y }: { task: Task; projectName?: string; x: number; y: number }) {
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
