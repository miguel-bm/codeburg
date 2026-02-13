import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SessionStatus, SidebarData } from '../api';
import { useSidebarData } from './useSidebarData';
import { useSharedWebSocket } from './useSharedWebSocket';
import { playNotificationSound } from '../lib/notificationSound';

const WAITING_NOTIFICATION_KEY_PREFIX = 'codeburg:waiting-notified:';
const WAITING_NOTIFICATION_TTL_MS = 6 * 60 * 60 * 1000;

// Draw a count badge on the favicon
function setFaviconBadge(count: number) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Base icon — green terminal bracket
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('>', 16, 17);

  if (count > 0) {
    // Badge circle
    const badgeText = count > 9 ? '9+' : String(count);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(25, 8, 9, 0, Math.PI * 2);
    ctx.fill();

    // Badge text
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, 25, 9);
  }

  const url = canvas.toDataURL('image/png');
  if (link) {
    link.href = url;
  } else {
    const newLink = document.createElement('link');
    newLink.rel = 'icon';
    newLink.href = url;
    document.head.appendChild(newLink);
  }
}

function getWaitingSessionIds(data: SidebarData | undefined): Set<string> {
  const ids = new Set<string>();
  if (!data?.projects) return ids;
  for (const project of data.projects) {
    for (const task of project.tasks) {
      for (const session of task.sessions) {
        if (session.status === 'waiting_input') {
          ids.add(session.id);
        }
      }
    }
  }
  return ids;
}

function getSessionStatuses(data: SidebarData | undefined): Map<string, SessionStatus> {
  const statuses = new Map<string, SessionStatus>();
  if (!data?.projects) return statuses;
  for (const project of data.projects) {
    for (const task of project.tasks) {
      for (const session of task.sessions) {
        statuses.set(session.id, session.status);
      }
    }
  }
  return statuses;
}

function shouldNotifySessionWaiting(sessionId: string): boolean {
  if (typeof window === 'undefined') return true;
  const key = `${WAITING_NOTIFICATION_KEY_PREFIX}${sessionId}`;
  const now = Date.now();
  const raw = window.localStorage.getItem(key);
  if (raw) {
    const last = Number(raw);
    if (Number.isFinite(last) && now - last < WAITING_NOTIFICATION_TTL_MS) {
      return false;
    }
  }
  window.localStorage.setItem(key, String(now));
  return true;
}

function clearSessionWaitingNotification(sessionId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${WAITING_NOTIFICATION_KEY_PREFIX}${sessionId}`);
}

export function useNotifications() {
  const prevWaitingIdsRef = useRef<Set<string> | null>(null);
  const sessionStatusRef = useRef<Map<string, SessionStatus>>(new Map());

  // Reuse the shared sidebar query (same queryKey so cache and polling are centralized)
  const { data: sidebar } = useSidebarData();
  const waitingSessionIds = useMemo(() => getWaitingSessionIds(sidebar), [sidebar]);
  const sessionStatuses = useMemo(() => getSessionStatuses(sidebar), [sidebar]);
  const waitingCount = waitingSessionIds.size;

  const notifyWaiting = useCallback((count: number) => {
    if (count <= 0) return;
    playNotificationSound();
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Codeburg', {
          body: `${count} agent${count > 1 ? 's' : ''} waiting for input`,
          tag: 'codeburg-waiting',
        });
      } catch {
        // Mobile browsers (e.g. iOS Safari) disallow the Notification constructor
      }
    }
  }, []);

  const { connected: wsConnected } = useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string; data?: { sessionId?: string; status?: SessionStatus } };
      if (msg.type !== 'sidebar_update') return;
      const sessionId = msg.data?.sessionId;
      const status = msg.data?.status;
      if (!sessionId || !status) return;

      const prevStatus = sessionStatusRef.current.get(sessionId);
      sessionStatusRef.current.set(sessionId, status);

      if (status === 'waiting_input' && prevStatus !== 'waiting_input' && shouldNotifySessionWaiting(sessionId)) {
        notifyWaiting(1);
      }

      if (status !== 'waiting_input') {
        clearSessionWaitingNotification(sessionId);
      }
    }, [notifyWaiting]),
  });

  // Request permission on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  // React to waiting count changes
  useEffect(() => {
    // Update favicon badge
    setFaviconBadge(waitingCount);

    // Update document title
    if (waitingCount > 0) {
      const baseTitle = document.title.replace(/^\[\d+\] /, '');
      document.title = `[${waitingCount}] ${baseTitle}`;
    } else {
      document.title = document.title.replace(/^\[\d+\] /, '');
    }

    // Keep a snapshot of latest session statuses for WS transition detection.
    // This also acts as reconciliation after reconnect.
    for (const [sessionId, status] of sessionStatuses) {
      sessionStatusRef.current.set(sessionId, status);
      if (status !== 'waiting_input') {
        clearSessionWaitingNotification(sessionId);
      }
    }
    for (const sessionId of Array.from(sessionStatusRef.current.keys())) {
      if (!sessionStatuses.has(sessionId)) {
        sessionStatusRef.current.delete(sessionId);
        clearSessionWaitingNotification(sessionId);
      }
    }

    // Fallback path: if realtime socket is disconnected, infer newly waiting sessions from snapshots.
    const previous = prevWaitingIdsRef.current;
    if (!wsConnected && previous) {
      let fallbackNewWaitingCount = 0;
      for (const id of waitingSessionIds) {
        if (!previous.has(id) && shouldNotifySessionWaiting(id)) {
          fallbackNewWaitingCount++;
        }
      }
      notifyWaiting(fallbackNewWaitingCount);
    }

    prevWaitingIdsRef.current = waitingSessionIds;
  }, [waitingCount, waitingSessionIds, sessionStatuses, notifyWaiting, wsConnected]);

  return waitingCount;
}
