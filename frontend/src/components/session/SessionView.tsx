import { useSession } from '../../hooks/useSession';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { SessionStatus } from '../../api/sessions';

interface SessionViewProps {
  sessionId: string;
  onStatusChange?: (status: SessionStatus) => void;
}

export function SessionView({ sessionId, onStatusChange }: SessionViewProps) {
  const { messages, status, isConnected, sendMessage } = useSession({
    sessionId,
    onStatusChange,
  });

  const isActive = status === 'running' || status === 'waiting_input' || status === 'idle';
  const canSendMessage = isConnected && (status === 'waiting_input' || status === 'idle');

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-3">
          <StatusIndicator status={status} />
          <span className="text-sm text-dim">
            session: {sessionId.slice(0, 8)}...
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && (
            <span className="text-xs text-[var(--color-status-blocked)]">
              disconnected
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      {isActive && (
        <MessageInput
          onSend={sendMessage}
          disabled={!canSendMessage}
          placeholder={
            status === 'running'
              ? 'Agent is working...'
              : status === 'waiting_input'
              ? 'Agent is waiting for input...'
              : 'Type a message...'
          }
        />
      )}

      {/* Completed/Error State */}
      {!isActive && (
        <div className="p-4 border-t border-subtle bg-secondary text-center">
          <span className="text-sm text-dim">
            {status === 'completed' ? '// session_completed' : '// session_error'}
          </span>
        </div>
      )}
    </div>
  );
}

interface StatusIndicatorProps {
  status: SessionStatus;
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'bg-accent animate-pulse';
      case 'waiting_input':
        return 'bg-[var(--color-status-in-progress)]';
      case 'completed':
        return 'bg-[var(--color-status-done)]';
      case 'error':
        return 'bg-[var(--color-status-blocked)]';
      default:
        return 'bg-[var(--color-text-dim)]';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'running';
      case 'waiting_input':
        return 'waiting';
      case 'completed':
        return 'done';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 ${getStatusColor()}`} />
      <span className="text-xs text-dim">{getStatusText()}</span>
    </div>
  );
}
