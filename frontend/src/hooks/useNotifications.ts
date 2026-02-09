import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sidebarApi } from '../api';
import type { SidebarData } from '../api';
import { useWebSocket } from './useWebSocket';
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

function countWaitingInput(data: SidebarData | undefined): number {
  if (!data?.projects) return 0;
  let count = 0;
  for (const project of data.projects) {
    for (const task of project.tasks) {
      for (const session of task.sessions) {
        if (session.status === 'waiting_input') count++;
      }
    }
  }
  return count;
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const prevCountRef = useRef(0);
  const permissionRef = useRef(Notification.permission);

  // Reuse the sidebar query (same queryKey so it shares cache)
  const { data: sidebar } = useQuery({
    queryKey: ['sidebar'],
    queryFn: sidebarApi.get,
    refetchInterval: 10000,
  });

  // Listen for real-time updates
  useWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type === 'sidebar_update') {
        queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      }
    }, [queryClient]),
  });

  // Request permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    }
  }, []);

  // React to waiting count changes
  useEffect(() => {
    const count = countWaitingInput(sidebar);

    // Update favicon badge
    setFaviconBadge(count);

    // Update document title
    if (count > 0) {
      const baseTitle = document.title.replace(/^\[\d+\] /, '');
      document.title = `[${count}] ${baseTitle}`;
    } else {
      document.title = document.title.replace(/^\[\d+\] /, '');
    }

    // Fire browser notification + sound for new waiting sessions
    if (count > prevCountRef.current && prevCountRef.current >= 0) {
      const delta = count - prevCountRef.current;
      playNotificationSound();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Codeburg', {
          body: `${delta} agent${delta > 1 ? 's' : ''} waiting for input`,
          tag: 'codeburg-waiting',
        });
      }
    }

    prevCountRef.current = count;
  }, [sidebar]);

  return countWaitingInput(sidebar);
}
