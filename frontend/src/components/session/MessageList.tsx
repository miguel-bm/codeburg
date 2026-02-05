import { useEffect, useRef } from 'react';
import type { SessionMessage } from '../../hooks/useSession';

interface MessageListProps {
  messages: SessionMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-dim text-sm">
        // no_messages_yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

interface MessageProps {
  message: SessionMessage;
}

function Message({ message }: MessageProps) {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';
  const isTool = message.type === 'tool';

  if (isSystem) {
    return (
      <div className="text-center text-xs text-dim py-2">
        {message.content}
      </div>
    );
  }

  if (isTool) {
    return <ToolMessage message={message} />;
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] p-3 border ${
          isUser
            ? 'border-accent bg-accent/10'
            : 'border-subtle bg-secondary'
        }`}
      >
        <div className="text-xs text-dim mb-1">
          {isUser ? '// you' : '// claude'}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-accent animate-pulse" />
          )}
        </div>
        <div className="text-xs text-dim mt-2">
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function ToolMessage({ message }: MessageProps) {
  const { toolUse, toolResult } = message;

  if (toolUse) {
    return (
      <div className="border border-subtle bg-secondary/50 p-3">
        <div className="text-xs text-dim mb-1">// tool_use</div>
        <div className="text-sm font-mono text-accent">
          {toolUse.name}
        </div>
        {toolUse.input != null && (
          <details className="mt-2">
            <summary className="text-xs text-dim cursor-pointer hover:text-[var(--color-text-primary)]">
              input
            </summary>
            <pre className="text-xs mt-1 p-2 bg-primary overflow-x-auto">
              {JSON.stringify(toolUse.input, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (toolResult) {
    return (
      <div className={`border p-3 ${toolResult.is_error ? 'border-[var(--color-status-blocked)] bg-[var(--color-status-blocked)]/10' : 'border-subtle bg-secondary/50'}`}>
        <div className="text-xs text-dim mb-1">
          // tool_result {toolResult.is_error && '(error)'}
        </div>
        <div className="text-sm whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {toolResult.content}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-subtle bg-secondary/50 p-3">
      <div className="text-xs text-dim mb-1">// tool</div>
      <div className="text-sm">{message.content}</div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
