import { createPortal } from 'react-dom';
import { HelpOverlay } from '../common/HelpOverlay';
import { CreateProjectModal } from '../common/CreateProjectModal';
import { ActionToast } from '../ui/ActionToast';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TaskCard } from './TaskCard';
import { TaskContextMenu } from './TaskContextMenu';
import { WorkflowPromptModal } from './WorkflowPromptModal';
import { TASK_STATUS } from '../../api';
import type { Task, TaskStatus } from '../../api';
import type { DragState } from '../../hooks/useDragAndDrop';

interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

interface WorkflowPromptState {
  taskId: string;
}

interface DashboardOverlaysProps {
  warning: string | null;
  onDismissWarning: () => void;

  isDragging: boolean;
  drag: DragState | null;
  tasks: Task[] | undefined;
  selectedProjectId?: string;
  getProjectName: (projectId: string) => string;

  contextMenu: ContextMenuState | null;
  onCloseContextMenu: () => void;
  onContextStatusChange: (taskId: string, status: TaskStatus) => void;
  onArchive: (taskId: string, archive: boolean) => void;
  onDeleteFromContext: (taskId: string) => void;

  showCreateProject: boolean;
  onCloseCreateProject: () => void;

  workflowPrompt: WorkflowPromptState | null;
  onCloseWorkflowPrompt: () => void;

  pendingDelete: string | null;
  onCloseDelete: () => void;
  onConfirmDelete: (taskId: string) => void;
  deletePending: boolean;

  showHelp: boolean;
  onCloseHelp: () => void;
}

export function DashboardOverlays({
  warning,
  onDismissWarning,
  isDragging,
  drag,
  tasks,
  selectedProjectId,
  getProjectName,
  contextMenu,
  onCloseContextMenu,
  onContextStatusChange,
  onArchive,
  onDeleteFromContext,
  showCreateProject,
  onCloseCreateProject,
  workflowPrompt,
  onCloseWorkflowPrompt,
  pendingDelete,
  onCloseDelete,
  onConfirmDelete,
  deletePending,
  showHelp,
  onCloseHelp,
}: DashboardOverlaysProps) {
  const contextTask = contextMenu ? tasks?.find((task) => task.id === contextMenu.taskId) : undefined;
  const pendingTask = pendingDelete ? tasks?.find((task) => task.id === pendingDelete) : undefined;

  return (
    <>
      <ActionToast
        toast={warning ? { type: 'warning', message: warning } : null}
        title="Task Update"
        onDismiss={onDismissWarning}
      />

      {isDragging && drag && (() => {
        const draggedTask = (tasks ?? []).find((task) => task.id === drag.taskId);
        if (!draggedTask) return null;
        const velocityX = drag.mouseX - drag.initialMouseX;
        const rotation = Math.max(-4, Math.min(4, velocityX * 0.02));

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

      {contextMenu && (
        <TaskContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          taskId={contextMenu.taskId}
          currentStatus={contextTask?.status ?? TASK_STATUS.BACKLOG}
          isArchived={!!contextTask?.archivedAt}
          onClose={onCloseContextMenu}
          onStatusChange={(status) => onContextStatusChange(contextMenu.taskId, status)}
          onArchive={onArchive}
          onDelete={onDeleteFromContext}
        />
      )}

      {showCreateProject && <CreateProjectModal onClose={onCloseCreateProject} />}

      {workflowPrompt && (
        <WorkflowPromptModal taskId={workflowPrompt.taskId} onClose={onCloseWorkflowPrompt} />
      )}

      <Modal
        open={!!pendingDelete}
        onClose={onCloseDelete}
        title="Delete task"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onCloseDelete}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (pendingDelete) onConfirmDelete(pendingDelete);
              }}
              loading={deletePending}
            >
              {deletePending ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-3">
          <p className="text-xs text-dim">
            Delete <strong className="text-[var(--color-text-primary)]">{pendingTask?.title ?? 'this task'}</strong>? This cannot be undone.
          </p>
        </div>
      </Modal>

      {showHelp && <HelpOverlay page="dashboard" onClose={onCloseHelp} />}
    </>
  );
}
