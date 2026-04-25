import { useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSharedWebSocket } from './useSharedWebSocket';

function isForeground() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function useSessionFocusPresence() {
  const activeSessionId = useWorkspaceStore((state) => {
    const active = state.tabs[state.activeTabIndex];
    return active?.type === 'session' ? active.sessionId : '';
  });
  const sessionId = useMemo(() => activeSessionId.trim(), [activeSessionId]);
  const { connected, send } = useSharedWebSocket();
  const lastSessionRef = useRef('');

  useEffect(() => {
    if (!connected) return;

    const previous = lastSessionRef.current;
    if (previous && previous !== sessionId) {
      send({ type: 'session_focus', sessionId: previous, focused: false });
    }
    lastSessionRef.current = sessionId;

    if (!sessionId) return;

    const report = () => {
      send({
        type: 'session_focus',
        sessionId,
        focused: isForeground(),
      });
    };

    report();
    const heartbeat = window.setInterval(report, 10_000);
    const onVisibility = () => report();
    const onFocus = () => report();
    const onBlur = () => report();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      send({ type: 'session_focus', sessionId, focused: false });
    };
  }, [connected, send, sessionId]);
}
