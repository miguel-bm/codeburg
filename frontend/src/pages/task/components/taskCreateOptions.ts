import { Bug, Hammer, ListTodo, Search, Sparkles, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TaskTypeValue = 'feature' | 'bug' | 'investigation' | 'chore' | 'improvement' | 'task';

export interface TaskTypeOption {
  value: TaskTypeValue;
  label: string;
  icon: LucideIcon;
}

export const TASK_TYPE_OPTIONS: TaskTypeOption[] = [
  { value: 'feature', label: 'Feature', icon: Sparkles },
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'investigation', label: 'Investigation', icon: Search },
  { value: 'chore', label: 'Chore', icon: Hammer },
  { value: 'improvement', label: 'Improvement', icon: Wrench },
  { value: 'task', label: 'Task', icon: ListTodo },
];

export type PriorityValue = 'none' | 'urgent' | 'high' | 'medium' | 'low';

export const PRIORITY_OPTIONS: Array<{ value: PriorityValue; label: string; color?: string }> = [
  { value: 'none', label: 'None' },
  { value: 'urgent', label: 'P0 · Urgent', color: 'var(--color-error)' },
  { value: 'high', label: 'P1 · High', color: '#f97316' },
  { value: 'medium', label: 'P2 · Medium', color: '#eab308' },
  { value: 'low', label: 'P3 · Low', color: 'var(--color-text-dim)' },
];
