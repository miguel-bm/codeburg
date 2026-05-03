import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionStatus, SidebarData, V2SidebarData } from '../api';
import type { AttentionEvent } from '../api/notifications';
import { sidebarApi } from '../api/sidebar';
import { v2Api } from '../api/v2';
import { useSharedWebSocket } from './useSharedWebSocket';
import { playNotificationSound } from '../lib/notificationSound';
import { registerCodeburgServiceWorker } from '../lib/webPush';
import { isDesktopShell } from '../platform/runtimeConfig';

const NOTIFIED_KEY_PREFIX = 'codeburg:attention-notified:';
const NOTIFIED_TTL_MS = 6 * 60 * 60 * 1000;

function setFaviconBadge(count: number) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('>', 16, 17);

  if (count > 0) {
    const badgeText = count > 9 ? '9+' : String(count);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(25, 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(badgeText, 25, 9);
  }

  const url = canvas.toDataURL('image/png');
  if (link) link.href = url;
  else {
    const newLink = document.createElement('link');
    newLink.rel = 'icon';
    newLink.href = url;
    document.head.appendChild(newLink);
  }
}

function attentionStorageKey(key: string): string {
  return `${NOTIFIED_KEY_PREFIX}${key}`;
}

function shouldNotify(key: string): boolean {
  if (typeof window === 'undefined') return true;
  const storageKey = attentionStorageKey(key);
  const now = Date.now();
  const raw = window.localStorage.getItem(storageKey);
  if (raw) {
    const last = Number(raw);
    if (Number.isFinite(last) && now - last < NOTIFIED_TTL_MS) return false;
  }
  window.localStorage.setItem(storageKey, String(now));
  return true;
}

function clearNotify(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(attentionStorageKey(key));
}

function getWaitingSessionIds(data: SidebarData | undefined): Set<string> {
  const ids = new Set<string>();
  for (const project of data?.projects ?? []) {
    for (const session of project.sessions) {
      if (session.status === 'waiting_input') ids.add(session.id);
    }
    for (const task of project.tasks) {
      for (const session of task.sessions) {
        if (session.status === 'waiting_input') ids.add(session.id);
      }
    }
  }
  return ids;
}

function getSessionStatuses(data: SidebarData | undefined): Map<string, SessionStatus> {
  const statuses = new Map<string, SessionStatus>();
  for (const project of data?.projects ?? []) {
    for (const session of project.sessions) statuses.set(session.id, session.status);
    for (const task of project.tasks) {
      for (const session of task.sessions) statuses.set(session.id, session.status);
    }
  }
  return statuses;
}

function getUnreadConversationIds(data: V2SidebarData | undefined): Set<string> {
  const ids = new Set<string>();
  for (const project of data?.projects ?? []) {
    for (const conversation of project.conversations ?? []) {
      if (conversation.unreadAt) ids.add(conversation.id);
    }
  }
  return ids;
}

async function showSystemNotification(event: Pick<AttentionEvent, 'title' | 'body' | 'url'>): Promise<void> {
  if (isDesktopShell() && window.codeburgDesktop?.notify) {
    const handled = await window.codeburgDesktop.notify({ title: event.title, body: event.body, url: event.url }).catch(() => false);
    if (handled) return;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => 'denied');
  }
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(event.title || 'Codeburg', {
      body: event.body,
      tag: event.url || 'codeburg-attention',
    });
    if (event.url) {
      n.onclick = () => {
        window.focus();
        window.location.assign(event.url!);
      };
    }
  } catch {
    // Some browser contexts disallow Notification constructor.
  }
}

export function useNotifications() {
  const prevWaitingIdsRef = useRef<Set<string> | null>(null);
  const prevUnreadConversationIdsRef = useRef<Set<string> | null>(null);
  const sessionStatusRef = useRef<Map<string, SessionStatus>>(new Map());

  const { data: sidebar } = useQuery({
    queryKey: ['sidebar'],
    queryFn: sidebarApi.get,
    refetchInterval: 60_000,
  });
  const { data: v2Sidebar } = useQuery({
    queryKey: ['v2-sidebar-summary'],
    queryFn: () => v2Api.getSidebar(),
    refetchInterval: 60_000,
  });

  const waitingSessionIds = useMemo(() => getWaitingSessionIds(sidebar), [sidebar]);
  const sessionStatuses = useMemo(() => getSessionStatuses(sidebar), [sidebar]);
  const unreadConversationIds = useMemo(() => getUnreadConversationIds(v2Sidebar), [v2Sidebar]);
  const attentionCount = waitingSessionIds.size + unreadConversationIds.size;

  const notify = useCallback((event: Pick<AttentionEvent, 'title' | 'body' | 'url'>) => {
    playNotificationSound();
    void showSystemNotification(event);
  }, []);

  const { connected: wsConnected } = useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string; data?: { sessionId?: string; status?: SessionStatus } } & Partial<AttentionEvent>;
      if (msg.type === 'attention') {
        const event = (msg.data ?? msg) as unknown as AttentionEvent;
        const key = `${event.targetType}:${event.targetId}:${event.reason}`;
        if (event.targetId && shouldNotify(key)) notify(event);
        return;
      }

      if (msg.type !== 'sidebar_update') return;
      const sessionId = msg.data?.sessionId;
      const status = msg.data?.status;
      if (!sessionId || !status) return;
      const prevStatus = sessionStatusRef.current.get(sessionId);
      sessionStatusRef.current.set(sessionId, status);
      const key = `session:${sessionId}:waiting`;
      if (status === 'waiting_input' && prevStatus !== 'waiting_input' && shouldNotify(key)) {
        notify({ title: 'Agent waiting for input', body: 'An agent needs your attention.' });
      }
      if (status !== 'waiting_input') clearNotify(key);
    }, [notify]),
  });

  useEffect(() => {
    void registerCodeburgServiceWorker();
  }, []);

  useEffect(() => {
    setFaviconBadge(attentionCount);
    if (isDesktopShell() && window.codeburgDesktop?.setDockBadge) {
      void window.codeburgDesktop.setDockBadge(attentionCount).catch(() => undefined);
    }
    if (attentionCount > 0) {
      const baseTitle = document.title.replace(/^\[\d+\] /, '');
      document.title = `[${attentionCount}] ${baseTitle}`;
    } else {
      document.title = document.title.replace(/^\[\d+\] /, '');
    }
  }, [attentionCount]);

  useEffect(() => {
    for (const [sessionId, status] of sessionStatuses) {
      sessionStatusRef.current.set(sessionId, status);
      if (status !== 'waiting_input') clearNotify(`session:${sessionId}:waiting`);
    }

    const previous = prevWaitingIdsRef.current;
    if (!wsConnected && previous) {
      for (const id of waitingSessionIds) {
        if (!previous.has(id) && shouldNotify(`session:${id}:waiting`)) {
          notify({ title: 'Agent waiting for input', body: 'An agent needs your attention.' });
        }
      }
    }
    prevWaitingIdsRef.current = waitingSessionIds;
  }, [sessionStatuses, waitingSessionIds, notify, wsConnected]);

  useEffect(() => {
    const previous = prevUnreadConversationIdsRef.current;
    if (!wsConnected && previous) {
      for (const id of unreadConversationIds) {
        if (!previous.has(id) && shouldNotify(`conversation:${id}:unread`)) {
          notify({ title: 'Pi chat waiting for input', body: 'A Pi chat needs your input.', url: `/conversations/${id}` });
        }
      }
    }
    for (const previousId of previous ?? []) {
      if (!unreadConversationIds.has(previousId)) clearNotify(`conversation:${previousId}:unread`);
    }
    prevUnreadConversationIdsRef.current = unreadConversationIds;
  }, [unreadConversationIds, notify, wsConnected]);

  return attentionCount;
}
