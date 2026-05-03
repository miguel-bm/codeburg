import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSharedWebSocket } from './useSharedWebSocket';

function isForeground() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

function conversationIdFromPath(pathname: string): string {
  return pathname.match(/^\/conversations\/([^/]+)/)?.[1] ?? '';
}

export function useConversationFocusPresence() {
  const location = useLocation();
  const conversationId = useMemo(() => conversationIdFromPath(location.pathname), [location.pathname]);
  const { connected, send } = useSharedWebSocket();
  const lastConversationRef = useRef('');

  useEffect(() => {
    if (!connected) return;

    const previous = lastConversationRef.current;
    if (previous && previous !== conversationId) {
      send({ type: 'focus_presence', targetType: 'conversation', targetId: previous, focused: false });
    }
    lastConversationRef.current = conversationId;

    if (!conversationId) return;

    const report = () => {
      send({
        type: 'focus_presence',
        targetType: 'conversation',
        targetId: conversationId,
        focused: isForeground(),
      });
    };

    report();
    const heartbeat = window.setInterval(report, 10_000);
    document.addEventListener('visibilitychange', report);
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      send({ type: 'focus_presence', targetType: 'conversation', targetId: conversationId, focused: false });
    };
  }, [connected, conversationId, send]);
}
