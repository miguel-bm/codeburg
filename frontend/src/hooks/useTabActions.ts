import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import { useWorkspaceSessions } from './useWorkspaceSessions';
import { sessionsApi } from '../api/sessions';
import type { AgentSession } from '../api/sessions';

/**
 * Wraps workspace store close functions with explicit session cleanup.
 * Session stop+delete only happens here — never as a side effect of store changes.
 */
export function useTabActions() {
  const { scopeType, scopeId } = useWorkspace();
  const { sessions } = useWorkspaceSessions();
  const queryClient = useQueryClient();

  /** Remove sessions from the query cache so sync (B) doesn't re-add their tabs */
  const removeFromCache = useCallback(
    (sessionIds: Set<string>) => {
      queryClient.setQueryData<AgentSession[]>(
        ['workspace-sessions', scopeType, scopeId],
        (old) => {
          if (!old) return old;
          return old.filter((s) => !sessionIds.has(s.id));
        },
      );
    },
    [queryClient, scopeType, scopeId],
  );

  /** Stop (if active) then delete a session */
  const cleanupSession = useCallback((session: AgentSession) => {
    if (session.status === 'running' || session.status === 'waiting_input') {
      sessionsApi.stop(session.id).finally(() => sessionsApi.delete(session.id).catch(() => {}));
    } else {
      sessionsApi.delete(session.id).catch(() => {});
    }
  }, []);

  const closeTab = useCallback(
    (index: number) => {
      const tab = useWorkspaceStore.getState().tabs[index];
      if (tab?.type === 'session') {
        const session = sessions.find((s) => s.id === tab.sessionId);
        if (session) {
          removeFromCache(new Set([session.id]));
          cleanupSession(session);
        }
      }
      useWorkspaceStore.getState().closeTab(index);
    },
    [sessions, removeFromCache, cleanupSession],
  );

  const closeOtherTabs = useCallback(
    (keepIndex: number) => {
      const tabs = useWorkspaceStore.getState().tabs;
      const sessionIdsToRemove = new Set<string>();

      tabs.forEach((tab, i) => {
        if (i !== keepIndex && tab.type === 'session') {
          sessionIdsToRemove.add(tab.sessionId);
        }
      });

      if (sessionIdsToRemove.size > 0) {
        removeFromCache(sessionIdsToRemove);
        for (const id of sessionIdsToRemove) {
          const session = sessions.find((s) => s.id === id);
          if (session) cleanupSession(session);
        }
      }
      useWorkspaceStore.getState().closeOtherTabs(keepIndex);
    },
    [sessions, removeFromCache, cleanupSession],
  );

  const closeTabsToRight = useCallback(
    (index: number) => {
      const tabs = useWorkspaceStore.getState().tabs;
      const sessionIdsToRemove = new Set<string>();

      for (let i = index + 1; i < tabs.length; i++) {
        const tab = tabs[i];
        if (tab.type === 'session') {
          sessionIdsToRemove.add(tab.sessionId);
        }
      }

      if (sessionIdsToRemove.size > 0) {
        removeFromCache(sessionIdsToRemove);
        for (const id of sessionIdsToRemove) {
          const session = sessions.find((s) => s.id === id);
          if (session) cleanupSession(session);
        }
      }
      useWorkspaceStore.getState().closeTabsToRight(index);
    },
    [sessions, removeFromCache, cleanupSession],
  );

  return { closeTab, closeOtherTabs, closeTabsToRight };
}
