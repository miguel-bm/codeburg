import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ExternalLink, Play, Plus, Square, Terminal } from 'lucide-react';
import { useWorkspaceRecipes } from '../../hooks/useWorkspaceRecipes';
import { useWorkspaceTunnels } from '../../hooks/useWorkspaceTunnels';
import { useWorkspaceSessions } from '../../hooks/useWorkspaceSessions';
import { useWorkspaceStore } from '../../stores/workspace';
import type { Recipe } from '../../api/workspace';

export function ToolsPanel() {
  const { recipes, isLoading: recipesLoading } = useWorkspaceRecipes();
  const { tunnels, isLoading: tunnelsLoading, createTunnel, isCreating, stopTunnel } = useWorkspaceTunnels();
  const { startSession } = useWorkspaceSessions();
  const { openSession } = useWorkspaceStore();
  const [showPortInput, setShowPortInput] = useState(false);
  const [port, setPort] = useState('');
  const [runningRecipe, setRunningRecipe] = useState<string | null>(null);

  // Draggable divider state
  const [splitFraction, setSplitFraction] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Group recipes by source
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, Recipe[]> = {};
    for (const recipe of recipes) {
      const key = recipe.source || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(recipe);
    }
    return groups;
  }, [recipes]);

  const sourceKeys = Object.keys(groupedRecipes);
  const hasMultipleGroups = sourceKeys.length > 1;

  // Horizontal divider drag
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const startFraction = splitFraction;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const newFraction = startFraction + delta / containerRect.height;
      setSplitFraction(Math.max(0.15, Math.min(0.85, newFraction)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [splitFraction]);

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Recipes pane */}
      <div className="overflow-auto" style={{ height: `${splitFraction * 100}%` }}>
        <div className="sticky top-0 z-10 px-2 py-1 text-[11px] font-medium text-dim bg-secondary">
          Recipes {recipes.length > 0 && <span className="text-[10px]">({recipes.length})</span>}
        </div>
        {recipesLoading && (
          <div className="px-2 py-3 text-xs text-dim">Loading...</div>
        )}
        {!recipesLoading && recipes.length === 0 && (
          <div className="px-2 py-3 text-xs text-dim">No recipes found</div>
        )}
        {sourceKeys.map((source) => (
          <div key={source}>
            {hasMultipleGroups && (
              <div className="px-2 py-0.5 text-[10px] text-dim bg-primary/50">
                {source}
              </div>
            )}
            {groupedRecipes[source].map((recipe) => (
              <RecipeEntry
                key={`${recipe.source}:${recipe.name}`}
                recipe={recipe}
                isRunning={runningRecipe === recipe.command}
                onRun={() => handleRunRecipe(recipe.command)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Draggable horizontal divider */}
      <div
        className="h-[3px] shrink-0 cursor-row-resize bg-[var(--color-border-subtle)] hover:bg-accent active:bg-accent transition-colors"
        onMouseDown={handleDividerMouseDown}
      />

      {/* Tunnels pane */}
      <div className="overflow-auto min-h-0" style={{ height: `${(1 - splitFraction) * 100}%` }}>
        <div className="sticky top-0 z-10 px-2 py-1 text-[11px] font-medium text-dim bg-secondary flex items-center justify-between">
          <span>Tunnels {tunnels.length > 0 && <span className="text-[10px]">({tunnels.length})</span>}</span>
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

/* ── Recipe entry with hover tooltip ─────────────────────────────── */

function RecipeEntry({
  recipe,
  isRunning,
  onRun,
}: {
  recipe: Recipe;
  isRunning: boolean;
  onRun: () => void;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback(() => {
    if (!rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setTooltip({ x: rect.right + 8, y: rect.top });
    }, 400);
  }, []);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <>
      <div
        ref={rowRef}
        className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-tertiary group"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        <Terminal size={12} className="text-dim shrink-0" />
        <span className="font-mono text-accent truncate">{recipe.name}</span>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="p-0.5 text-dim hover:text-accent opacity-0 group-hover:opacity-100 shrink-0 disabled:opacity-50"
          title={`Run: ${recipe.command}`}
        >
          <Play size={12} />
        </button>
      </div>

      {tooltip && <RecipeTooltip recipe={recipe} position={tooltip} />}
    </>
  );
}

function RecipeTooltip({ recipe, position }: { recipe: Recipe; position: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const el = ref.current;
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${position.x - rect.width - 16}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [position]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] w-72 bg-card rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-card-hover)] overflow-hidden pointer-events-none"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 py-2 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-accent shrink-0" />
          <span className="font-mono text-xs text-accent">{recipe.name}</span>
          <span className="text-[10px] text-dim ml-auto">{recipe.source}</span>
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {recipe.description && (
          <p className="text-xs text-[var(--color-text-primary)]">{recipe.description}</p>
        )}
        <div>
          <div className="text-[10px] text-dim mb-0.5">Command</div>
          <pre className="text-[11px] font-mono text-[var(--color-text-primary)] bg-secondary rounded px-2 py-1 whitespace-pre-wrap break-all">{recipe.command}</pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}
