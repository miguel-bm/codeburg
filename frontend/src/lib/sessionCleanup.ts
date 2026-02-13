import { sessionsApi } from '../api/sessions';
import type { AgentSession } from '../api/sessions';

function isActiveSession(status: AgentSession['status']): boolean {
  return status === 'running' || status === 'waiting_input';
}

/**
 * Best-effort stop for active sessions, then hard-delete.
 * Delete failures are surfaced to caller; stop failures are ignored.
 */
export async function cleanupAgentSession(session: Pick<AgentSession, 'id' | 'status'>): Promise<void> {
  if (isActiveSession(session.status)) {
    try {
      await sessionsApi.stop(session.id);
    } catch {
      // Continue to delete; stale sessions should still be cleaned up.
    }
  }

  await sessionsApi.delete(session.id);
}
