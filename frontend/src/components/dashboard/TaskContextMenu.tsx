import { useEffect } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { COLUMNS, COLUMN_ICONS } from '../../constants/tasks';
import type { TaskStatus } from '../../api';

interface TaskContextMenuProps {
  x: number;
  y: number;
  taskId: string;
  currentStatus: TaskStatus;
  isArchived?: boolean;
  onClose: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onArchive?: (taskId: string, archive: boolean) => void;
  onDelete?: (taskId: string) => void;
}

export function TaskContextMenu({ x, y, taskId, currentStatus, isArchived, onClose, onStatusChange, onArchive, onDelete }: TaskContextMenuProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const menuStyle = {
    left: Math.min(x, window.innerWidth - 160),
    top: Math.min(y, window.innerHeight - 200),
  };

  const showArchiveOption = onArchive && (currentStatus === 'done' || isArchived);

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
        {(showArchiveOption || onDelete) && (
          <div className="border-t border-subtle my-1" />
        )}
        {showArchiveOption && (
          <button
            onClick={() => { onArchive(taskId, !isArchived); onClose(); }}
            className="w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary"
          >
            {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => { onDelete(taskId); onClose(); }}
            className="w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 text-[var(--color-error)]/70 hover:text-[var(--color-error)] hover:bg-tertiary"
          >
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>
    </>
  );
}
