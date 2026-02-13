import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupAgentSession } from './sessionCleanup';
import { sessionsApi } from '../api/sessions';

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    stop: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedSessionsApi = vi.mocked(sessionsApi);

describe('cleanupAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSessionsApi.stop.mockResolvedValue(undefined);
    mockedSessionsApi.delete.mockResolvedValue(undefined);
  });

  it('stops active sessions before deleting', async () => {
    await cleanupAgentSession({ id: 'session-1', status: 'running' });

    expect(mockedSessionsApi.stop).toHaveBeenCalledWith('session-1');
    expect(mockedSessionsApi.delete).toHaveBeenCalledWith('session-1');
    expect(mockedSessionsApi.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSessionsApi.delete.mock.invocationCallOrder[0],
    );
  });

  it('deletes terminal sessions without stopping', async () => {
    await cleanupAgentSession({ id: 'session-2', status: 'completed' });

    expect(mockedSessionsApi.stop).not.toHaveBeenCalled();
    expect(mockedSessionsApi.delete).toHaveBeenCalledWith('session-2');
  });

  it('still deletes when stop fails', async () => {
    mockedSessionsApi.stop.mockRejectedValueOnce(new Error('stop failed'));

    await cleanupAgentSession({ id: 'session-3', status: 'waiting_input' });

    expect(mockedSessionsApi.stop).toHaveBeenCalledWith('session-3');
    expect(mockedSessionsApi.delete).toHaveBeenCalledWith('session-3');
  });

  it('surfaces delete failures to caller', async () => {
    mockedSessionsApi.delete.mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      cleanupAgentSession({ id: 'session-4', status: 'completed' }),
    ).rejects.toThrow('delete failed');
  });
});
