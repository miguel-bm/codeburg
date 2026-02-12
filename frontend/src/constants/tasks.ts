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
