import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../api/sessions';
import { resolveSessionSelection } from './useWorkspaceSessionSync';

function makeSession(id: string, createdAt: string): AgentSession {
  return {
    id,
    projectId: 'project-1',
    provider: 'codex',
    sessionType: 'terminal',
    status: 'running',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('resolveSessionSelection', () => {
  it('returns requested session id when it exists', () => {
    const sessions = [
      makeSession('session-1', '2026-01-01T00:00:00Z'),
      makeSession('session-2', '2026-01-02T00:00:00Z'),
    ];

    expect(resolveSessionSelection('session-1', sessions)).toBe('session-1');
  });

  it('falls back to newest available session when requested one is stale', () => {
    const sessions = [
      makeSession('older', '2026-01-01T00:00:00Z'),
      makeSession('newer', '2026-01-03T00:00:00Z'),
      makeSession('middle', '2026-01-02T00:00:00Z'),
    ];

    expect(resolveSessionSelection('deleted-session', sessions)).toBe('newer');
  });

  it('returns undefined when no sessions exist', () => {
    expect(resolveSessionSelection('deleted-session', [])).toBeUndefined();
  });
});
