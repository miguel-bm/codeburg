import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/auth';

type MessageHandler = (data: unknown) => void;

interface UseWebSocketOptions {
  onMessage?: MessageHandler;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectInterval = 1000,
    maxReconnectAttempts = 10,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
  });

  // Use refs for callbacks to avoid recreating connect on every render
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  onMessageRef.current = onMessage;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  const token = useAuthStore((s) => s.token);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (connectingRef.current) return;
    if (!mountedRef.current) return;

    connectingRef.current = true;
    setState((s) => ({ ...s, connecting: true, error: null }));

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      connectingRef.current = false;
      reconnectAttemptsRef.current = 0;
      setState({ connected: true, connecting: false, error: null });
      onConnectRef.current?.();

      if (tokenRef.current) {
        ws.send(JSON.stringify({ type: 'auth', token: tokenRef.current }));
      }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      setState((s) => ({ ...s, connected: false, connecting: false }));
      wsRef.current = null;
      onDisconnectRef.current?.();

      if (autoReconnect && mountedRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
        const attempt = reconnectAttemptsRef.current;
        // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
        const delay = Math.min(reconnectInterval * Math.pow(2, attempt), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, error: 'WebSocket connection error' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch {
        console.error('Invalid WebSocket message:', event.data);
      }
    };
    // Only stable values in deps - no state, no callback props
  }, [autoReconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback((channel: string, id: string) => {
    send({ type: 'subscribe', channel, id });
  }, [send]);

  const unsubscribe = useCallback((channel: string, id: string) => {
    send({ type: 'unsubscribe', channel, id });
  }, [send]);

  const sendMessage = useCallback((sessionId: string, content: string) => {
    send({ type: 'message', sessionId, content });
  }, [send]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    send,
    subscribe,
    unsubscribe,
    sendMessage,
  };
}
