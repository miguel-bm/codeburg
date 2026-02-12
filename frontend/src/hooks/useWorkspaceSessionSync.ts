import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspaceStore } from '../stores/workspace';
import type { WorkspaceTab } from '../stores/workspace';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import { useWorkspaceSessions } from './useWorkspaceSessions';
import { sessionsApi } from '../api/sessions';
import type { AgentSession } from '../api/sessions';

/**
 * Synchronizes API sessions, workspace tabs, and URL params.
 *
 * (A) Resets tabs when scope changes (switching tasks/projects)
 * (B) Syncs API sessions → tabs (add missing, remove stale)
 * (C) Activates session from ?session= URL param
 * (D) Stops/deletes sessions when their tabs are closed
 */
export function useWorkspaceSessionSync() {
  const { scopeId } = useWorkspace();
  const { sessions } = useWorkspaceSessions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openSession, resetTabs } = useWorkspaceStore();

  // Keep refs for subscribe callback (avoids stale closures)
  const sessionsRef = useRef<AgentSession[]>([]);
  sessionsRef.current = sessions;

  // Track previous scope to detect changes
  const prevScopeIdRef = useRef<string>(scopeId);

  // Track whether initial sync has occurred for this scope
  const initialSyncDoneRef = useRef(false);

  // (A) Reset tabs on scope change
  useEffect(() => {
    if (prevScopeIdRef.current !== scopeId) {
      resetTabs();
      initialSyncDoneRef.current = false;
      prevScopeIdRef.current = scopeId;
    }
  }, [scopeId, resetTabs]);

  // (B) Sync API sessions → tabs
  useEffect(() => {
    if (sessions.length === 0 && !initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;

    const currentTabs = useWorkspaceStore.getState().tabs;
    const sessionTabIds = new Set(
      currentTabs
        .filter((t): t is WorkspaceTab & { type: 'session' } => t.type === 'session')
        .map((t) => t.sessionId),
    );
    const apiSessionIds = new Set(sessions.map((s) => s.id));

    // Add tabs for sessions that don't have one
    for (const session of sessions) {
      if (!sessionTabIds.has(session.id)) {
        openSession(session.id);
      }
    }

    // Remove tabs for sessions that no longer exist
    for (const tabSessionId of sessionTabIds) {
      if (!apiSessionIds.has(tabSessionId)) {
        const state = useWorkspaceStore.getState();
        const idx = state.tabs.findIndex(
          (t) => t.type === 'session' && t.sessionId === tabSessionId,
        );
        if (idx >= 0) {
          state.closeTab(idx);
        }
      }
    }
  }, [sessions, openSession]);

  // (C) Activate session from URL param
  useEffect(() => {
    const sessionId = searchParams.get('session');
    if (!sessionId) return;

    openSession(sessionId);

    // Clear the param to avoid re-triggering
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('session');
      return next;
    }, { replace: true });
  }, [searchParams, openSession, setSearchParams]);

  // (D) Stop/delete sessions when tabs are closed
  useEffect(() => {
    let prevSessionIds = new Set(
      useWorkspaceStore.getState().tabs
        .filter((t): t is WorkspaceTab & { type: 'session' } => t.type === 'session')
        .map((t) => t.sessionId),
    );

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      const currentSessionIds = new Set(
        state.tabs
          .filter((t): t is WorkspaceTab & { type: 'session' } => t.type === 'session')
          .map((t) => t.sessionId),
      );

      // Find removed session IDs
      for (const id of prevSessionIds) {
        if (!currentSessionIds.has(id)) {
          const session = sessionsRef.current.find((s) => s.id === id);
          if (session && (session.status === 'running' || session.status === 'waiting_input')) {
            // Stop then delete
            sessionsApi.stop(id).finally(() => sessionsApi.delete(id).catch(() => {}));
          } else {
            sessionsApi.delete(id).catch(() => {});
          }
        }
      }

      prevSessionIds = currentSessionIds;
    });

    return unsubscribe;
  }, []);
}
