import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { buildWsUrl } from '../platform/runtimeConfig';

type MessageHandler = (data: unknown) => void;
type VoidHandler = () => void;

interface UseSharedWebSocketOptions {
  onMessage?: MessageHandler;
  onConnect?: VoidHandler;
  onDisconnect?: VoidHandler;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface SharedWebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

interface SharedSubscriber {
  id: number;
  onMessage?: MessageHandler;
  onConnect?: VoidHandler;
  onDisconnect?: VoidHandler;
  autoReconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  onStateChange?: (state: SharedWebSocketState) => void;
}

class SharedWebSocketManager {
  private ws: WebSocket | null = null;

  private reconnectTimeout: number | null = null;

  private reconnectAttempts = 0;

  private connecting = false;

  private token: string | null = null;

  private nextId = 1;

  private state: SharedWebSocketState = {
    connected: false,
    connecting: false,
    error: null,
  };

  private subscribers = new Map<number, SharedSubscriber>();

  getState(): SharedWebSocketState {
    return this.state;
  }

  setToken(nextToken: string | null): void {
    if (this.token === nextToken) return;
    this.token = nextToken;

    if (this.subscribers.size === 0) return;
    // Force reconnect so auth is always aligned with current token.
    this.forceReconnect();
  }

  subscribe(subscriber: Omit<SharedSubscriber, 'id'>): () => void {
    const id = this.nextId++;
    this.subscribers.set(id, { ...subscriber, id });
    subscriber.onStateChange?.(this.state);
    this.connect();

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) {
        this.teardownSocket();
      }
    };
  }

  connect = (): void => {
    if (this.subscribers.size === 0) return;
    if (this.connecting) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.connecting = true;
    this.setState((prev) => ({ ...prev, connecting: true, error: null }));

    const wsPath = this.token ? `/ws?token=${encodeURIComponent(this.token)}` : '/ws';
    const ws = new WebSocket(buildWsUrl(wsPath));
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.setState({ connected: true, connecting: false, error: null });

      if (this.token) {
        ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      }

      for (const sub of this.subscribers.values()) {
        sub.onConnect?.();
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connecting = false;
      this.setState((prev) => ({ ...prev, connected: false, connecting: false }));
      for (const sub of this.subscribers.values()) {
        sub.onDisconnect?.();
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.setState((prev) => ({ ...prev, error: 'WebSocket connection error' }));
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const data = JSON.parse(event.data);
        for (const sub of this.subscribers.values()) {
          sub.onMessage?.(data);
        }
      } catch {
        console.error('Invalid WebSocket message:', event.data);
      }
    };
  };

  disconnect = (): void => {
    this.teardownSocket();
  };

  send(message: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private setState(next: SharedWebSocketState | ((prev: SharedWebSocketState) => SharedWebSocketState)): void {
    this.state = typeof next === 'function' ? next(this.state) : next;
    for (const sub of this.subscribers.values()) {
      sub.onStateChange?.(this.state);
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private getReconnectPolicy(): { enabled: boolean; delayMs: number; maxAttempts: number } {
    let enabled = false;
    let delayMs = Number.POSITIVE_INFINITY;
    let maxAttempts = 0;

    for (const sub of this.subscribers.values()) {
      if (sub.autoReconnect) {
        enabled = true;
        delayMs = Math.min(delayMs, sub.reconnectInterval);
        maxAttempts = Math.max(maxAttempts, sub.maxReconnectAttempts);
      }
    }

    return {
      enabled,
      delayMs: Number.isFinite(delayMs) ? delayMs : 1000,
      maxAttempts,
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimeout();
    if (this.subscribers.size === 0) return;

    const policy = this.getReconnectPolicy();
    if (!policy.enabled) return;
    if (this.reconnectAttempts >= policy.maxAttempts) return;

    const attempt = this.reconnectAttempts;
    const delay = Math.min(policy.delayMs * Math.pow(2, attempt), 30000);
    this.reconnectAttempts++;
    this.reconnectTimeout = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    this.clearReconnectTimeout();
    this.reconnectAttempts = 0;
    this.connecting = false;

    const ws = this.ws;
    this.ws = null;

    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }

    this.setState((prev) => ({ ...prev, connected: false, connecting: false }));
  }

  private forceReconnect(): void {
    this.teardownSocket();
    this.connect();
  }
}

const sharedWebSocketManager = new SharedWebSocketManager();

export function useSharedWebSocket(options: UseSharedWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectInterval = 1000,
    maxReconnectAttempts = 10,
  } = options;

  const [state, setState] = useState<SharedWebSocketState>(() => sharedWebSocketManager.getState());
  const token = useAuthStore((s) => s.token);

  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
  }, [onMessage, onConnect, onDisconnect]);

  useEffect(() => {
    sharedWebSocketManager.setToken(token);
  }, [token]);

  useEffect(() => {
    return sharedWebSocketManager.subscribe({
      onMessage: (data) => onMessageRef.current?.(data),
      onConnect: () => onConnectRef.current?.(),
      onDisconnect: () => onDisconnectRef.current?.(),
      onStateChange: setState,
      autoReconnect,
      reconnectInterval,
      maxReconnectAttempts,
    });
  }, [autoReconnect, reconnectInterval, maxReconnectAttempts]);

  const send = useCallback((message: unknown) => {
    sharedWebSocketManager.send(message);
  }, []);

  const connect = useCallback(() => {
    sharedWebSocketManager.connect();
  }, []);

  const disconnect = useCallback(() => {
    sharedWebSocketManager.disconnect();
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
