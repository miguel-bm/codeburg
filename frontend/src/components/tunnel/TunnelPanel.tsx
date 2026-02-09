import { useTunnels } from '../../hooks/useTunnels';

interface TunnelPanelProps {
  taskId: string;
}

export function TunnelPanel({ taskId }: TunnelPanelProps) {
  const {
    tunnels, isLoading, port, setPort, showCreate, setShowCreate,
    createMutation, stopMutation, copied, copyUrl, handleCreate,
  } = useTunnels(taskId);

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-dim">
        Loading tunnels...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Tunnels</span>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs text-accent hover:underline"
          >
            + New
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="p-4 border-b border-subtle">
          <div className="flex gap-2">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="port (e.g. 3000)"
              min="1"
              max="65535"
              className="flex-1 px-2 py-1 text-sm bg-primary border border-subtle rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
              autoFocus
            />
            <button
              type="submit"
              disabled={createMutation.isPending || !port}
              className="px-3 py-1 text-sm bg-accent text-white rounded-md font-medium hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? '...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-2 py-1 text-sm text-dim hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
          {createMutation.error && (
            <div className="mt-2 text-xs text-[var(--color-error)]">
              {createMutation.error.message}
            </div>
          )}
        </form>
      )}

      {/* Tunnel List */}
      <div className="flex-1 overflow-y-auto">
        {tunnels.length === 0 ? (
          <div className="p-4 text-sm text-dim text-center">
            No active tunnels
            <div className="mt-2 text-xs">
              Create a tunnel to expose a local port to the internet
            </div>
          </div>
        ) : (
          <div className="divide-y divide-subtle">
            {tunnels.map((tunnel) => (
              <div key={tunnel.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-mono text-accent">
                    :{tunnel.port}
                  </div>
                  <button
                    onClick={() => stopMutation.mutate(tunnel.id)}
                    disabled={stopMutation.isPending}
                    className="text-xs text-[var(--color-error)] hover:underline disabled:opacity-50"
                  >
                    Stop
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <a
                    href={tunnel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-dim hover:text-accent break-all"
                  >
                    {tunnel.url}
                  </a>
                  <button
                    onClick={() => copyUrl(tunnel.url)}
                    className={`text-xs shrink-0 ${copied ? 'text-accent' : 'text-dim hover:text-[var(--color-text-primary)]'}`}
                    title="Copy URL"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
