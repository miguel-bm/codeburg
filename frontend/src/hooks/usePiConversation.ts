import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v2Api } from '../api/v2';
import type { PiConversationSnapshot } from '../api/types';
import { buildWsUrl } from '../platform/runtimeConfig';
import { useAuthStore } from '../stores/auth';

const MAX_RETRIES = 6;
const RETRY_DELAYS_MS = [600, 1000, 1800, 3000, 5000, 8000];

interface SnapshotEvent {
  type: 'snapshot';
  snapshot: PiConversationSnapshot;
}

interface ErrorEvent {
  type: 'error';
  error?: string;
}

type PiConversationSocketEvent = SnapshotEvent | ErrorEvent;

export interface UsePiConversationResult {
  snapshot: PiConversationSnapshot | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  abort: () => Promise<void>;
  applySnapshot: (snapshot: PiConversationSnapshot) => void;
}

export function usePiConversation(conversationId: string, enabled = true): UsePiConversationResult {
  const token = useAuthStore((state) => state.token);

  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const disposedRef = useRef(false);

  const [snapshot, setSnapshot] = useState<PiConversationSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsUrl = useMemo(() => {
    let path = `/ws/conversation?conversation=${encodeURIComponent(conversationId)}`;
    if (token) {
      path += `&token=${encodeURIComponent(token)}`;
    }
    return buildWsUrl(path);
  }, [conversationId, token]);

  useEffect(() => {
    if (!enabled || !conversationId) {
      disposedRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setConnecting(false);
      return;
    }

    disposedRef.current = false;
    setSnapshot(null);
    setConnected(false);
    setConnecting(true);
    setError(null);
    retryCountRef.current = 0;

    const connect = () => {
      if (disposedRef.current) return;
      setConnecting(true);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposedRef.current || ws !== wsRef.current) return;
        setConnected(true);
        setConnecting(false);
        setError(null);
        retryCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (disposedRef.current || ws !== wsRef.current) return;
        let data: PiConversationSocketEvent;
        try {
          data = JSON.parse(event.data) as PiConversationSocketEvent;
        } catch {
          return;
        }

        if (data.type === 'snapshot') {
          setSnapshot(data.snapshot);
          return;
        }
        if (data.type === 'error') {
          setError(data.error ?? 'Conversation error');
        }
      };

      ws.onerror = () => {
        if (disposedRef.current || ws !== wsRef.current) return;
        setError('WebSocket error');
      };

      ws.onclose = () => {
        if (disposedRef.current || ws !== wsRef.current) return;
        setConnected(false);
        setConnecting(false);

        if (retryCountRef.current >= MAX_RETRIES) {
          setError('Connection lost. Reload to reconnect.');
          return;
        }

        const delay = RETRY_DELAYS_MS[Math.min(retryCountRef.current, RETRY_DELAYS_MS.length - 1)];
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposedRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [wsUrl, enabled, conversationId]);

  const sendMessage = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const nextSnapshot = await v2Api.promptConversation(conversationId, { message: trimmed });
    setSnapshot(nextSnapshot);
  }, [conversationId]);

  const abort = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'abort' }));
      return;
    }
    await v2Api.abortConversation(conversationId);
  }, [conversationId]);

  const applySnapshot = useCallback((nextSnapshot: PiConversationSnapshot) => {
    setSnapshot(nextSnapshot);
  }, []);

  return {
    snapshot,
    connected,
    connecting,
    error,
    sendMessage,
    abort,
    applySnapshot,
  };
}
