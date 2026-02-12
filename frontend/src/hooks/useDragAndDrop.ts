import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskStatus } from '../api';

export interface DragState {
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

interface Column {
  id: TaskStatus;
  title: string;
  color: string;
}

interface UseDragAndDropOptions {
  columns: Column[];
  getColumnTasks: (colIdx: number) => Task[];
  tasks: Task[] | undefined;
  hasAdvancedFilters: boolean;
  enabled: boolean;
  columnRefs: React.RefObject<(HTMLDivElement | null)[]>;
  cardRefs: React.RefObject<Map<string, HTMLDivElement>>;
  onDrop: (taskId: string, targetStatus: TaskStatus, targetPosition: number) => void;
  onReorder: (taskId: string, newPosition: number) => void;
  onClick: (task: Task) => void;
}

const DRAG_THRESHOLD = 5;

export function useDragAndDrop({
  columns,
  getColumnTasks,
  tasks,
  hasAdvancedFilters,
  enabled,
  columnRefs,
  cardRefs,
  onDrop,
  onReorder,
  onClick,
}: UseDragAndDropOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, task: Task, colIdx: number, cardIdx: number) => {
    if (!enabled || e.button !== 0) return;
    const cardEl = cardRefs.current?.get(task.id);
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
  }, [enabled, cardRefs]);

  // Calculate target column and position from mouse position
  const calcDropTarget = useCallback((mouseX: number, mouseY: number): { col: number; position: number } => {
    // Find target column
    let targetCol = 0;
    const cols = columnRefs.current;
    if (cols) {
      for (let i = 0; i < columns.length; i++) {
        const colEl = cols[i];
        if (!colEl) continue;
        const rect = colEl.getBoundingClientRect();
        if (mouseX >= rect.left && mouseX <= rect.right) {
          targetCol = i;
          break;
        }
        // If past the last column, use the last
        if (i === columns.length - 1) targetCol = i;
        // If between columns, pick closest
        if (mouseX < rect.left) {
          targetCol = i;
          break;
        }
      }
    }

    // Find target position within column
    const colTasks = getColumnTasks(targetCol);
    let targetPosition = colTasks.length; // default: end

    for (let i = 0; i < colTasks.length; i++) {
      const task = colTasks[i];
      // Skip the dragged card in source column
      if (drag && task.id === drag.taskId) continue;
      const cardEl = cardRefs.current?.get(task.id);
      if (!cardEl) continue;
      const rect = cardEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (mouseY < midY) {
        targetPosition = i;
        break;
      }
    }

    return { col: targetCol, position: targetPosition };
  }, [columns, getColumnTasks, drag, columnRefs, cardRefs]);

  useEffect(() => {
    if (!drag || !enabled) return;

    let frameId: number | null = null;
    const onMouseMove = (e: MouseEvent) => {
      if (hasAdvancedFilters) return; // Disable dragging when filters active
      if (frameId !== null) cancelAnimationFrame(frameId);
      const { clientX, clientY } = e;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        const { col, position } = calcDropTarget(clientX, clientY);
        setDrag((d) => d ? { ...d, mouseX: clientX, mouseY: clientY, targetCol: col, targetPosition: position } : null);
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      setDrag((d) => {
        if (!d) return null;
        const dist = Math.hypot(e.clientX - d.initialMouseX, e.clientY - d.initialMouseY);
        if (dist < DRAG_THRESHOLD) {
          // Click — navigate
          const task = (tasks ?? []).find((t) => t.id === d.taskId);
          if (task) onClick(task);
        } else if (!hasAdvancedFilters) {
          // Drop — update task (disabled when filters active)
          const sourceStatus = columns[d.sourceCol].id;
          const targetStatus = columns[d.targetCol].id;
          const colTasks = getColumnTasks(d.targetCol);

          const targetTask = colTasks[d.targetPosition];
          const endPosition = colTasks.length > 0 ? colTasks[colTasks.length - 1].position + 1 : 0;

          if (sourceStatus !== targetStatus) {
            // Cross-column move
            onDrop(d.taskId, targetStatus, targetTask ? targetTask.position : endPosition);
          } else if (d.targetPosition !== d.sourceCard) {
            // Same-column reorder
            onReorder(d.taskId, targetTask ? targetTask.position : endPosition);
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
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [drag, enabled, hasAdvancedFilters, calcDropTarget, tasks, columns, getColumnTasks, onClick, onDrop, onReorder]);

  // Is dragging (mouse has moved enough)?
  const isDragging = enabled
    && !hasAdvancedFilters
    && drag
    && Math.hypot(drag.mouseX - drag.initialMouseX, drag.mouseY - drag.initialMouseY) >= DRAG_THRESHOLD;

  return { drag, setDrag, isDragging: !!isDragging, handleMouseDown };
}
