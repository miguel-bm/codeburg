import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildWsUrl } from '../platform/runtimeConfig';
import { useAuthStore } from '../stores/auth';
import { sessionsApi } from '../api/sessions';
import type { ChatMessage } from '../api/chat';
import type { SessionStatus } from '../api/sessions';

const MAX_RETRIES = 6;
const RETRY_DELAYS_MS = [600, 1000, 1800, 3000, 5000, 8000];

interface UseChatSessionResult {
  messages: ChatMessage[];
  connected: boolean;
  connecting: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  interrupt: () => void;
}

interface SnapshotEvent {
  type: 'snapshot';
  messages: ChatMessage[];
}

interface MessageEvent {
  type: 'message';
  message: ChatMessage;
}

interface ErrorEvent {
  type: 'error';
  error?: string;
}

type ChatSocketEvent = SnapshotEvent | MessageEvent | ErrorEvent;

function upsertMessage(prev: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const index = prev.findIndex((msg) => msg.id === next.id);
  if (index >= 0) {
    const updated = [...prev];
    updated[index] = next;
    return updated;
  }

  const out = [...prev, next];
  out.sort((a, b) => {
    const seqA = a.seq ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.seq ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tsA - tsB;
  });
  return out;
}

export function useChatSession(sessionId: string, sessionStatus?: SessionStatus): UseChatSessionResult {
  const token = useAuthStore((s) => s.token);

  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const disposedRef = useRef(false);
  const sessionStatusRef = useRef(sessionStatus);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  const wsUrl = useMemo(() => {
    let path = `/ws/chat?session=${encodeURIComponent(sessionId)}`;
    if (token) {
      path += `&token=${encodeURIComponent(token)}`;
    }
    return buildWsUrl(path);
  }, [sessionId, token]);

  useEffect(() => {
    disposedRef.current = false;
    setMessages([]);
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
        let data: ChatSocketEvent;
        try {
          data = JSON.parse(event.data) as ChatSocketEvent;
        } catch {
          return;
        }

        if (data.type === 'snapshot') {
          const sorted = [...(data.messages || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
          setMessages(sorted);
          return;
        }
        if (data.type === 'message') {
          setMessages((prev) => upsertMessage(prev, data.message));
          return;
        }
        if (data.type === 'error') {
          setError(data.error ?? 'Session error');
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

        const status = sessionStatusRef.current;
        if (status === 'completed' || status === 'error') {
          return;
        }

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
  }, [wsUrl]);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    await sessionsApi.sendMessage(sessionId, trimmed);
  }, [sessionId]);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'interrupt' }));
  }, []);

  return {
    messages,
    connected,
    connecting,
    error,
    sendMessage,
    interrupt,
  };
}

