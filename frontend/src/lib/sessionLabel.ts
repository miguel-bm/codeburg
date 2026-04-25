import type { AgentSession } from '../api/sessions';
import type { SidebarSession } from '../api/types';

type SessionLike = Pick<AgentSession, 'id' | 'provider' | 'displayName'>;

export function buildSessionOrdinalMap(sessions: Pick<AgentSession, 'id' | 'createdAt'>[]): Map<string, number> {
  const sorted = [...sessions].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  const ordinals = new Map<string, number>();
  sorted.forEach((session, idx) => {
    ordinals.set(session.id, idx + 1);
  });
  return ordinals;
}

export function sessionLabel(session: SessionLike, ordinal?: number): string {
  const name = session.displayName?.trim();
  if (name) return name;
  if (ordinal && ordinal > 0) return `${session.provider} #${ordinal}`;
  return session.provider;
}

export function sidebarSessionLabel(session: SidebarSession): string {
  const name = session.displayName?.trim();
  if (name) return name;
  return `${session.provider} #${session.number}`;
}
