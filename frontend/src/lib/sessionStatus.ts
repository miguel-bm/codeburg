import type { SessionStatus } from '../api/sessions';

interface SessionStatusMeta {
  label: string;
  dotClass: string;
  textClass: string;
}

const DEFAULT_META: SessionStatusMeta = {
  label: 'Idle',
  dotClass: 'bg-[var(--color-text-dim)]',
  textClass: 'text-dim',
};

export function getSessionStatusMeta(status: SessionStatus | string): SessionStatusMeta {
  switch (status) {
    case 'running':
      return {
        label: 'Running',
        dotClass: 'bg-accent animate-pulse',
        textClass: 'status-in-progress',
      };
    case 'waiting_input':
      return {
        label: 'Waiting input',
        dotClass: 'bg-[var(--color-warning)] animate-pulse',
        textClass: 'text-[var(--color-warning)]',
      };
    case 'completed':
      return {
        label: 'Completed',
        dotClass: 'bg-[var(--color-status-done)]',
        textClass: 'status-done',
      };
    case 'error':
      return {
        label: 'Error',
        dotClass: 'bg-[var(--color-error)]',
        textClass: 'text-[var(--color-error)]',
      };
    default:
      return DEFAULT_META;
  }
}
