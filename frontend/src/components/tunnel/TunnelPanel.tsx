import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tunnelsApi } from '../../api';

interface TunnelPanelProps {
  taskId: string;
}

export function TunnelPanel({ taskId }: TunnelPanelProps) {
  const queryClient = useQueryClient();
  const [port, setPort] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: tunnels, isLoading } = useQuery({
    queryKey: ['tunnels', taskId],
    queryFn: () => tunnelsApi.list(taskId),
    refetchInterval: 10000, // Poll to detect stopped tunnels
  });

  const createMutation = useMutation({
    mutationFn: (port: number) => tunnelsApi.create(taskId, port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
      setPort('');
      setShowCreate(false);
    },
  });

  const stopMutation = useMutation({
    mutationFn: (tunnelId: string) => tunnelsApi.stop(tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(port, 10);
    if (portNum > 0 && portNum <= 65535) {
      createMutation.mutate(portNum);
    }
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-dim">
        loading tunnels...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle flex items-center justify-between">
        <span className="text-sm text-dim">// tunnels</span>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs text-accent hover:underline"
          >
            + new
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
              className="flex-1 px-2 py-1 text-sm bg-primary border border-subtle focus:border-accent focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={createMutation.isPending || !port}
              className="px-3 py-1 text-sm border border-accent text-accent hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? '...' : 'create'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-2 py-1 text-sm text-dim hover:text-[var(--color-text-primary)]"
            >
              cancel
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
        {tunnels?.length === 0 ? (
          <div className="p-4 text-sm text-dim text-center">
            // no active tunnels
            <div className="mt-2 text-xs">
              Create a tunnel to expose a local port to the internet
            </div>
          </div>
        ) : (
          <div className="divide-y divide-subtle">
            {tunnels?.map((tunnel) => (
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
                    stop
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
                    onClick={() => copyToClipboard(tunnel.url)}
                    className="text-xs text-dim hover:text-[var(--color-text-primary)] shrink-0"
                    title="Copy URL"
                  >
                    copy
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
