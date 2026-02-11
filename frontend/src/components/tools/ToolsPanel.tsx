import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, FileCode, Globe } from 'lucide-react';
import { recipesApi, type TaskRecipe } from '../../api';
import { useTunnels } from '../../hooks/useTunnels';

interface ToolsPanelProps {
  taskId: string;
  onRecipeRun: (command: string) => void;
}

export function ToolsPanel({ taskId, onRecipeRun }: ToolsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [recipesPanelPct, setRecipesPanelPct] = useState(58);
  const draggingRef = useRef(false);

  const onDividerDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(30, Math.min(80, pct));
      setRecipesPanelPct(clamped);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden text-xs">
      <div style={{ height: `${recipesPanelPct}%` }} className="min-h-0 overflow-hidden">
        <RecipesSection taskId={taskId} onRecipeRun={onRecipeRun} />
      </div>

      <div
        onMouseDown={onDividerDown}
        className="h-1 shrink-0 cursor-row-resize border-y border-subtle hover:bg-accent/40 transition-colors"
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <TunnelsSection taskId={taskId} />
      </div>
    </div>
  );
}

function RecipesSection({ taskId, onRecipeRun }: { taskId: string; onRecipeRun: (cmd: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['task-recipes', taskId],
    queryFn: () => recipesApi.listTaskRecipes(taskId),
  });

  const grouped = useMemo(() => {
    const groupedMap = new Map<string, TaskRecipe[]>();
    if (!data?.recipes?.length) return groupedMap;

    for (const recipe of data.recipes) {
      const current = groupedMap.get(recipe.source) || [];
      current.push(recipe);
      groupedMap.set(recipe.source, current);
    }

    const ordered = new Map<string, TaskRecipe[]>();
    const sourceOrder = data.sources.length > 0 ? data.sources : [...groupedMap.keys()].sort();
    for (const source of sourceOrder) {
      const items = groupedMap.get(source);
      if (items?.length) {
        ordered.set(source, items);
      }
    }
    return ordered;
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-full min-h-0 flex flex-col">
        <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-dim border-b border-subtle">
          Recipes
        </div>
        <div className="px-3 py-2 text-dim">Loading recipes...</div>
      </div>
    );
  }

  if (!data?.recipes?.length) {
    return (
      <div className="h-full min-h-0 flex flex-col">
        <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-dim border-b border-subtle">
          Recipes
        </div>
        <div className="px-3 py-4 text-dim flex flex-col items-center gap-1.5 text-center">
          <FileCode size={28} className="text-dim" />
          <span>No recipes found</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-dim border-b border-subtle">
        Recipes
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
        {[...grouped.entries()].map(([source, recipes]) => (
          <div key={source}>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.12em] text-dim">{source}</div>
            <div className="space-y-1">
              {recipes.map((recipe) => (
                <div
                  key={`${recipe.source}:${recipe.name}:${recipe.command}`}
                  className="flex items-center gap-2 rounded-md border border-subtle bg-secondary px-2 py-1.5"
                  title={recipe.description || recipe.command}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-[var(--color-text-primary)] truncate">{recipe.name}</div>
                    <div className="font-mono text-[10px] text-dim truncate">{recipe.command}</div>
                  </div>
                  <button
                    onClick={() => onRecipeRun(recipe.command)}
                    className="h-6 w-6 shrink-0 rounded-md border border-subtle bg-tertiary text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors inline-flex items-center justify-center"
                    aria-label={`Run ${recipe.name}`}
                  >
                    <Play size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TunnelsSection({ taskId }: { taskId: string }) {
  const {
    tunnels, suggestions, suggestionsLoading,
    port, setPort, showCreate, setShowCreate,
    createMutation, stopMutation, scanMutation, copied, copyUrl, handleCreate,
  } = useTunnels(taskId);

  const openTunnel = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-1.5 flex items-center justify-between border-b border-subtle">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Tunnels</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="text-dim hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            {scanMutation.isPending ? 'Scanning...' : 'Scan ports'}
          </button>
          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-accent hover:underline"
            >
              + New
            </button>
          )}
        </div>
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
              className="w-20 px-2 py-0.5 bg-primary border border-subtle rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
              autoFocus
            />
            <button
              type="submit"
              disabled={createMutation.isPending || !port}
              className="px-2 py-0.5 bg-accent text-white rounded-md font-medium hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              Go
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        {scanMutation.error && (
          <div className="px-3 pt-2 text-[10px] text-[var(--color-error)]">
            {scanMutation.error.message}
          </div>
        )}

        {suggestionsLoading && (
          <div className="px-3 pt-2 text-dim">Loading suggestions...</div>
        )}

        {suggestions.length > 0 && (
          <div className="px-3 pt-2 pb-1 border-b border-subtle">
            <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">Suggested Ports</div>
            <div className="space-y-1">
              {suggestions.map((suggestion) => (
                <div key={suggestion.port} className="flex items-center gap-2">
                  <span className="font-mono text-accent">:{suggestion.port}</span>
                  <span className="text-[10px] text-dim">
                    {suggestion.sources.join(' + ')}
                  </span>
                  {suggestion.status === 'suggested' ? (
                    <button
                      onClick={() => createMutation.mutate(suggestion.port)}
                      disabled={createMutation.isPending}
                      className="text-accent hover:underline disabled:opacity-50"
                    >
                      Create
                    </button>
                  ) : suggestion.existingTunnel ? (
                    <>
                      <button
                        onClick={() => openTunnel(suggestion.existingTunnel!.url)}
                        className="text-dim hover:text-accent"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => copyUrl(suggestion.existingTunnel!.url)}
                        className={`text-dim hover:text-accent ${copied ? 'text-accent' : ''}`}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      {suggestion.status === 'already_tunneled_other_task' && suggestion.existingTunnel.taskTitle && (
                        <span className="text-[10px] text-dim truncate">
                          in {suggestion.existingTunnel.taskTitle}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] text-dim">Already tunneled</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tunnels.length > 0 && (
          <div className="px-3 py-2 space-y-1">
            {tunnels.map((tunnel) => (
              <div key={tunnel.id} className="flex items-center gap-2">
                <span className="font-mono text-accent">:{tunnel.port}</span>
                <button
                  onClick={() => copyUrl(tunnel.url)}
                  className={`text-dim hover:text-accent truncate ${copied ? 'text-accent' : ''}`}
                  title={tunnel.url}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => stopMutation.mutate(tunnel.id)}
                  className="text-dim hover:text-[var(--color-error)]"
                >
                  Stop
                </button>
              </div>
            ))}
          </div>
        )}

        {tunnels.length === 0 && suggestions.length === 0 && !showCreate && (
          <div className="px-3 py-4 text-dim flex flex-col items-center gap-1.5 text-center">
            <Globe size={28} className="text-dim" />
            <span>No tunnels</span>
          </div>
        )}
      </div>
    </div>
  );
}
