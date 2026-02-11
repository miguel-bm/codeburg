import { useEffect, useMemo, useRef } from 'react';
import type { SidebarData } from '../api';
import { useSidebarData } from './useSidebarData';
import { playNotificationSound } from '../lib/notificationSound';

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

export function useNotifications() {
  const prevWaitingIdsRef = useRef<Set<string> | null>(null);

  // Reuse the shared sidebar query (same queryKey so cache and polling are centralized)
  const { data: sidebar } = useSidebarData();
  const waitingSessionIds = useMemo(() => getWaitingSessionIds(sidebar), [sidebar]);
  const waitingCount = waitingSessionIds.size;

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

    const previous = prevWaitingIdsRef.current;
    let newWaitingCount = 0;
    if (previous) {
      for (const id of waitingSessionIds) {
        if (!previous.has(id)) {
          newWaitingCount++;
        }
      }
    }

    // Fire browser notification + sound only for newly-entered waiting sessions.
    // Skip alerts on initial load by requiring previous state to exist.
    if (previous && newWaitingCount > 0) {
      playNotificationSound();
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Codeburg', {
          body: `${newWaitingCount} agent${newWaitingCount > 1 ? 's' : ''} waiting for input`,
          tag: 'codeburg-waiting',
        });
      }
    }

    prevWaitingIdsRef.current = waitingSessionIds;
  }, [waitingCount, waitingSessionIds]);

  return waitingCount;
}
