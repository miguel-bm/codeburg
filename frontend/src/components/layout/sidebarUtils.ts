import type { SidebarData } from '../../api';

export function countWaiting(data: SidebarData | undefined): number {
  if (!data?.projects) return 0;
  let n = 0;
  for (const p of data.projects) {
    for (const s of p.sessions) {
      if (s.status === 'waiting_input') n++;
    }
    for (const t of p.tasks) {
      for (const s of t.sessions) {
        if (s.status === 'waiting_input') n++;
      }
    }
  }
  return n;
}
