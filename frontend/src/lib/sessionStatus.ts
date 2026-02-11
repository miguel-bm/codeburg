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

function normalizeSessionStatus(status: SessionStatus | string): SessionStatus | 'unknown' {
  if (status === 'idle' || status === 'running' || status === 'waiting_input' || status === 'completed' || status === 'error') {
    return status;
  }

  const value = String(status).trim().toLowerCase();
  if (!value) return 'unknown';

  if (value.includes('wait') || value.includes('input') || value.includes('prompt')) return 'waiting_input';
  if (value.includes('run') || value.includes('active') || value.includes('progress')) return 'running';
  if (value.includes('complete') || value.includes('done') || value.includes('finish') || value.includes('success')) return 'completed';
  if (value.includes('error') || value.includes('fail') || value.includes('crash')) return 'error';
  if (value.includes('idle') || value.includes('queue') || value.includes('pending') || value.includes('created')) return 'idle';

  return 'unknown';
}

export function getSessionStatusMeta(status: SessionStatus | string): SessionStatusMeta {
  switch (normalizeSessionStatus(status)) {
    case 'running':
      return {
        label: 'Running',
        dotClass: 'bg-accent',
        textClass: 'status-in-progress',
      };
    case 'waiting_input':
      return {
        label: 'Waiting input',
        dotClass: 'bg-[var(--color-warning)]',
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
