import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket';

// Types matching backend
export type SessionStatus = 'idle' | 'running' | 'waiting_input' | 'completed' | 'error';

export type EventType = 'system' | 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'error' | 'status';

export interface ToolUseEvent {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultEvent {
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface AgentEvent {
  type: EventType;
  timestamp: string;
  content?: string;
  tool_use?: ToolUseEvent;
  tool_result?: ToolResultEvent;
  error?: string;
  raw?: unknown;
}

export interface SessionMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolUse?: ToolUseEvent;
  toolResult?: ToolResultEvent;
  isStreaming?: boolean;
}

interface UseSessionOptions {
  sessionId: string;
  onStatusChange?: (status: SessionStatus) => void;
}

export function useSession({ sessionId, onStatusChange }: UseSessionOptions) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const currentMessageRef = useRef<SessionMessage | null>(null);
  const messageIdCounter = useRef(0);

  const generateId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${messageIdCounter.current}-${Date.now()}`;
  }, []);

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as { type: string; sessionId?: string; data?: AgentEvent };

    // Only process messages for this session
    if (msg.sessionId && msg.sessionId !== sessionId) return;

    if (msg.type === 'agent_event' && msg.data) {
      const event = msg.data;

      switch (event.type) {
        case 'assistant': {
          // Streaming assistant message
          if (currentMessageRef.current?.type === 'assistant' && currentMessageRef.current.isStreaming) {
            // Append to existing streaming message
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].isStreaming) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + (event.content || ''),
                };
              }
              return updated;
            });
          } else {
            // Start new streaming message
            const newMessage: SessionMessage = {
              id: generateId(),
              type: 'assistant',
              content: event.content || '',
              timestamp: new Date(event.timestamp),
              isStreaming: true,
            };
            currentMessageRef.current = newMessage;
            setMessages((prev) => [...prev, newMessage]);
          }
          break;
        }

        case 'user': {
          // Finalize any streaming message
          finalizeCurrentMessage();

          const newMessage: SessionMessage = {
            id: generateId(),
            type: 'user',
            content: event.content || '',
            timestamp: new Date(event.timestamp),
          };
          setMessages((prev) => [...prev, newMessage]);
          break;
        }

        case 'tool_use': {
          // Finalize any streaming message first
          finalizeCurrentMessage();

          const newMessage: SessionMessage = {
            id: generateId(),
            type: 'tool',
            content: `Using tool: ${event.tool_use?.name}`,
            timestamp: new Date(event.timestamp),
            toolUse: event.tool_use,
          };
          setMessages((prev) => [...prev, newMessage]);
          break;
        }

        case 'tool_result': {
          const newMessage: SessionMessage = {
            id: generateId(),
            type: 'tool',
            content: event.tool_result?.content || '',
            timestamp: new Date(event.timestamp),
            toolResult: event.tool_result,
          };
          setMessages((prev) => [...prev, newMessage]);
          break;
        }

        case 'system': {
          finalizeCurrentMessage();

          const newMessage: SessionMessage = {
            id: generateId(),
            type: 'system',
            content: event.content || '',
            timestamp: new Date(event.timestamp),
          };
          setMessages((prev) => [...prev, newMessage]);
          break;
        }

        case 'status': {
          finalizeCurrentMessage();

          const newStatus = event.content as SessionStatus;
          if (newStatus) {
            setStatus(newStatus);
            onStatusChange?.(newStatus);
          }
          break;
        }

        case 'error': {
          finalizeCurrentMessage();

          const newMessage: SessionMessage = {
            id: generateId(),
            type: 'system',
            content: `Error: ${event.error || event.content}`,
            timestamp: new Date(event.timestamp),
          };
          setMessages((prev) => [...prev, newMessage]);
          setStatus('error');
          onStatusChange?.('error');
          break;
        }
      }
    } else if (msg.type === 'session_ended') {
      finalizeCurrentMessage();
      setStatus('completed');
      onStatusChange?.('completed');
    } else if (msg.type === 'message_sent') {
      // User message was sent successfully
      setStatus('running');
    }
  }, [sessionId, generateId, onStatusChange]);

  const finalizeCurrentMessage = useCallback(() => {
    if (currentMessageRef.current?.isStreaming) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].isStreaming) {
          updated[lastIdx] = { ...updated[lastIdx], isStreaming: false };
        }
        return updated;
      });
      currentMessageRef.current = null;
    }
  }, []);

  const { connected, subscribe, unsubscribe, sendMessage: wsSendMessage } = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => setIsConnected(true),
    onDisconnect: () => setIsConnected(false),
  });

  // Subscribe to session on mount
  useEffect(() => {
    if (connected && sessionId) {
      subscribe('session', sessionId);
      return () => unsubscribe('session', sessionId);
    }
  }, [connected, sessionId, subscribe, unsubscribe]);

  const sendMessage = useCallback((content: string) => {
    // Add user message optimistically
    const newMessage: SessionMessage = {
      id: generateId(),
      type: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setStatus('running');

    // Send via WebSocket
    wsSendMessage(sessionId, content);
  }, [sessionId, wsSendMessage, generateId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    currentMessageRef.current = null;
  }, []);

  return {
    messages,
    status,
    isConnected,
    sendMessage,
    clearMessages,
  };
}
