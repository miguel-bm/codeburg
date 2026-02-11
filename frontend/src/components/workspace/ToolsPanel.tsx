import { useState } from 'react';
import { Copy, ExternalLink, Play, Plus, Square, Terminal } from 'lucide-react';
import { useWorkspaceRecipes } from '../../hooks/useWorkspaceRecipes';
import { useWorkspaceTunnels } from '../../hooks/useWorkspaceTunnels';
import { useWorkspaceSessions } from '../../hooks/useWorkspaceSessions';
import { useWorkspaceStore } from '../../stores/workspace';

export function ToolsPanel() {
  const { recipes, sources, isLoading: recipesLoading } = useWorkspaceRecipes();
  const { tunnels, isLoading: tunnelsLoading, createTunnel, isCreating, stopTunnel } = useWorkspaceTunnels();
  const { startSession } = useWorkspaceSessions();
  const { openSession } = useWorkspaceStore();
  const [showPortInput, setShowPortInput] = useState(false);
  const [port, setPort] = useState('');
  const [runningRecipe, setRunningRecipe] = useState<string | null>(null);

  const handleRunRecipe = async (command: string) => {
    setRunningRecipe(command);
    try {
      const session = await startSession({ provider: 'terminal', prompt: command });
      openSession(session.id);
    } finally {
      setRunningRecipe(null);
    }
  };

  const handleCreateTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(port, 10);
    if (!p || p < 1) return;
    await createTunnel(p);
    setPort('');
    setShowPortInput(false);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  const hasMultipleSources = sources.length > 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Recipes section */}
      <div className="border-b border-subtle">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-dim bg-secondary">
          Recipes
        </div>
        <div className="max-h-48 overflow-auto">
          {recipesLoading && (
            <div className="px-2 py-3 text-xs text-dim">Loading...</div>
          )}
          {!recipesLoading && recipes.length === 0 && (
            <div className="px-2 py-3 text-xs text-dim">No recipes found</div>
          )}
          {recipes.map((recipe) => (
            <div
              key={`${recipe.source}:${recipe.name}`}
              className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-tertiary group"
            >
              <Terminal size={12} className="text-dim shrink-0" />
              <span className="font-mono text-accent truncate">{recipe.name}</span>
              {hasMultipleSources && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-dim shrink-0">
                  {recipe.source}
                </span>
              )}
              {recipe.description && (
                <span className="text-dim truncate text-[10px] ml-auto">{recipe.description}</span>
              )}
              <button
                onClick={() => handleRunRecipe(recipe.command)}
                disabled={runningRecipe === recipe.command}
                className="p-0.5 text-dim hover:text-accent opacity-0 group-hover:opacity-100 shrink-0 disabled:opacity-50"
                title={`Run: ${recipe.command}`}
              >
                <Play size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tunnels section */}
      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-dim bg-secondary flex items-center justify-between">
          <span>Tunnels</span>
          <button
            onClick={() => setShowPortInput(!showPortInput)}
            className="p-0.5 text-dim hover:text-accent"
            title="New tunnel"
          >
            <Plus size={12} />
          </button>
        </div>

        {showPortInput && (
          <form onSubmit={handleCreateTunnel} className="flex items-center gap-1 px-2 py-1.5 border-b border-subtle bg-accent/5">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Port..."
              autoFocus
              min={1}
              max={65535}
              className="flex-1 px-2 py-1 text-xs bg-primary border border-subtle rounded-md focus:border-accent focus:outline-none w-20"
              onKeyDown={(e) => { if (e.key === 'Escape') setShowPortInput(false); }}
            />
            <button
              type="submit"
              disabled={isCreating}
              className="text-xs text-accent px-2 py-1 hover:bg-accent/10 rounded disabled:opacity-50"
            >
              {isCreating ? '...' : 'Create'}
            </button>
          </form>
        )}

        {tunnelsLoading && (
          <div className="px-2 py-3 text-xs text-dim">Loading...</div>
        )}
        {!tunnelsLoading && tunnels.length === 0 && !showPortInput && (
          <div className="px-2 py-3 text-xs text-dim">No active tunnels</div>
        )}
        {tunnels.map((tunnel) => (
          <div key={tunnel.id} className="flex items-center gap-1.5 px-2 py-1 text-xs group hover:bg-tertiary">
            <span className="font-mono text-dim">:{tunnel.port}</span>
            {tunnel.url && (
              <>
                <a
                  href={tunnel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-accent hover:underline flex-1 text-[11px]"
                >
                  {tunnel.url.replace(/^https?:\/\//, '')}
                </a>
                <button
                  onClick={() => copyUrl(tunnel.url)}
                  className="p-0.5 text-dim hover:text-accent opacity-0 group-hover:opacity-100"
                  title="Copy URL"
                >
                  <Copy size={11} />
                </button>
                <a
                  href={tunnel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-0.5 text-dim hover:text-accent opacity-0 group-hover:opacity-100"
                  title="Open"
                >
                  <ExternalLink size={11} />
                </a>
              </>
            )}
            <button
              onClick={() => stopTunnel(tunnel.id)}
              className="p-0.5 text-dim hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100"
              title="Stop"
            >
              <Square size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
