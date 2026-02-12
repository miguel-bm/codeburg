/** Slugify a single path segment (lowercase, alphanumeric + hyphens). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a branch name from a task title.
 * Colons act as path separators (e.g. "feat: login" → "feat/login").
 */
export function buildBranchName(title: string): string {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return '';

  const colonAsPath = normalized.replace(/\s*:\s*/g, '/');
  const segments = colonAsPath
    .split('/')
    .map((segment) => slugify(segment))
    .filter(Boolean);

  if (segments.length === 0) return 'task';
  return segments.join('/').slice(0, 80);
}

/** Pick a deterministic color from a palette based on a string hash. */
export function pickColorFromName(name: string, palette: string[]): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

/** Format a date string as a relative time (e.g. "3h ago", "2d ago"). */
export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}
