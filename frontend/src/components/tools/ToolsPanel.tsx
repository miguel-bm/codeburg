import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { justfileApi, tunnelsApi } from '../../api';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface ToolsPanelProps {
  taskId: string;
  onRecipeRun: (command: string) => void;
}

export function ToolsPanel({ taskId, onRecipeRun }: ToolsPanelProps) {
  return (
    <div className="flex flex-col overflow-y-auto text-xs">
      <RecipesSection taskId={taskId} onRecipeRun={onRecipeRun} />
      <TunnelsSection taskId={taskId} />
    </div>
  );
}

function RecipesSection({ taskId, onRecipeRun }: { taskId: string; onRecipeRun: (cmd: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['task-justfile', taskId],
    queryFn: () => justfileApi.listTaskRecipes(taskId),
  });

  if (isLoading) {
    return <div className="px-3 py-2 text-dim">loading recipes...</div>;
  }

  if (!data?.hasJustfile || data.recipes.length === 0) {
    return (
      <div className="px-3 py-2 border-b border-subtle">
        <span className="text-dim">// recipes</span>
        <div className="mt-1 text-dim">no justfile found</div>
      </div>
    );
  }

  return (
    <div className="border-b border-subtle">
      <div className="px-3 py-1.5 text-dim">// recipes</div>
      <div className="px-2 pb-2 flex flex-wrap gap-1">
        {data.recipes.map((recipe) => (
          <button
            key={recipe.name}
            onClick={() => onRecipeRun(`just ${recipe.name}`)}
            className="px-2 py-0.5 border border-subtle text-dim hover:text-accent hover:border-accent transition-colors"
            title={recipe.description || recipe.name}
          >
            {recipe.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function TunnelsSection({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const [port, setPort] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: tunnels } = useQuery({
    queryKey: ['tunnels', taskId],
    queryFn: () => tunnelsApi.list(taskId),
    refetchInterval: 10000,
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

  const { copied, copy: copyToClipboard } = useCopyToClipboard();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(port, 10);
    if (portNum > 0 && portNum <= 65535) {
      createMutation.mutate(portNum);
    }
  };

  return (
    <div>
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-dim">// tunnels</span>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-accent hover:underline"
          >
            + new
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="px-3 pb-2">
          <div className="flex gap-1">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="port"
              min="1"
              max="65535"
              className="w-20 px-2 py-0.5 bg-primary border border-subtle focus:border-accent focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={createMutation.isPending || !port}
              className="px-2 py-0.5 border border-accent text-accent hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              go
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-1 text-dim hover:text-[var(--color-text-primary)]"
            >
              x
            </button>
          </div>
        </form>
      )}

      {tunnels && tunnels.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          {tunnels.map((tunnel) => (
            <div key={tunnel.id} className="flex items-center gap-2">
              <span className="font-mono text-accent">:{tunnel.port}</span>
              <button
                onClick={() => copyToClipboard(tunnel.url)}
                className={`text-dim hover:text-accent truncate ${copied ? 'text-accent' : ''}`}
                title={tunnel.url}
              >
                {copied ? 'copied' : 'copy'}
              </button>
              <button
                onClick={() => stopMutation.mutate(tunnel.id)}
                className="text-dim hover:text-[var(--color-error)]"
              >
                stop
              </button>
            </div>
          ))}
        </div>
      )}

      {(!tunnels || tunnels.length === 0) && !showCreate && (
        <div className="px-3 pb-2 text-dim">no tunnels</div>
      )}
    </div>
  );
}
