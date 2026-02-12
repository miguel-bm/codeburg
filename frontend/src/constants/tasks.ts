import { Inbox, Play, Eye, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskStatus } from '../api';
import { TASK_STATUS } from '../api';

/** Shared color palette for auto-assigning label colors. */
export const DEFAULT_LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

/** Priority display colors (CSS values). */
export const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: '#f97316',
  medium: '#eab308',
  low: 'var(--color-text-dim)',
};

/** Priority short labels. */
export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
};

export const COLUMN_ICONS: Record<string, LucideIcon> = {
  [TASK_STATUS.BACKLOG]: Inbox,
  [TASK_STATUS.IN_PROGRESS]: Play,
  [TASK_STATUS.IN_REVIEW]: Eye,
  [TASK_STATUS.DONE]: CheckCircle2,
};

export const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: TASK_STATUS.BACKLOG, title: 'Backlog', color: 'status-backlog' },
  { id: TASK_STATUS.IN_PROGRESS, title: 'In Progress', color: 'status-in-progress' },
  { id: TASK_STATUS.IN_REVIEW, title: 'In Review', color: 'status-in-review' },
  { id: TASK_STATUS.DONE, title: 'Done', color: 'status-done' },
];
