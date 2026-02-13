import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../stores/workspace';
import type { WorkspaceTab } from '../stores/workspace';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import { useWorkspaceSessions } from './useWorkspaceSessions';
import { useSharedWebSocket } from './useSharedWebSocket';

/**
 * Synchronizes API sessions, workspace tabs, and URL params.
 *
 * (A) Resets tabs when scope changes (switching tasks/projects)
 * (B) Syncs API sessions → tabs (add missing, remove stale — no destructive API calls)
 * (C) Activates session from ?session= URL param
 * (WS) Listens for sidebar_update to invalidate workspace-sessions query
 *
 * Session cleanup (stop + delete) is handled exclusively by useTabActions at
 * explicit user call sites (close button, context menu), never as a side effect.
 */
export function useWorkspaceSessionSync() {
  const { scopeId, scopeType } = useWorkspace();
  const { sessions } = useWorkspaceSessions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openSession, resetTabs } = useWorkspaceStore();
  const queryClient = useQueryClient();

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

  // (B) Sync API sessions → tabs (add-only + remove tabs for server-deleted sessions)
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

    // Remove tabs for sessions no longer in API (already deleted server-side, safe)
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

  // (WS) Invalidate workspace-sessions query on sidebar_update for near-instant tab sync
  useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type === 'sidebar_update') {
        queryClient.invalidateQueries({
          queryKey: ['workspace-sessions', scopeType, scopeId],
        });
      }
    }, [queryClient, scopeType, scopeId]),
  });
}
