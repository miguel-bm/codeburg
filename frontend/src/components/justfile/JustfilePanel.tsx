import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { justfileApi } from '../../api';
import type { Recipe } from '../../api';

interface JustfilePanelProps {
  taskId: string;
}

export function JustfilePanel({ taskId }: JustfilePanelProps) {
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [output, setOutput] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [args, setArgs] = useState<string>('');
  const outputRef = useRef<HTMLPreElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['justfile', taskId],
    queryFn: () => justfileApi.listTaskRecipes(taskId),
  });

  const runMutation = useMutation({
    mutationFn: ({ recipe, args }: { recipe: string; args?: string[] }) =>
      justfileApi.runTaskRecipe(taskId, recipe, args),
    onSuccess: (result) => {
      setOutput(result.output);
      setIsRunning(false);
    },
    onError: (error) => {
      setOutput(`Error: ${error.message}`);
      setIsRunning(false);
    },
  });

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleRun = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setOutput('');
    setIsRunning(true);

    const argArray = args.trim() ? args.trim().split(/\s+/) : undefined;
    runMutation.mutate({ recipe: recipe.name, args: argArray });
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-dim">
        loading justfile...
      </div>
    );
  }

  if (!data?.hasJustfile) {
    return (
      <div className="p-4 text-sm text-dim">
        // no justfile found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Recipe List */}
      <div className="border-b border-subtle">
        <div className="px-4 py-2 text-xs text-dim">
          // recipes ({data.recipes.length})
        </div>
        <div className="max-h-48 overflow-y-auto">
          {data.recipes.map((recipe) => (
            <button
              key={recipe.name}
              onClick={() => handleRun(recipe)}
              disabled={isRunning}
              className={`w-full px-4 py-2 text-left hover:bg-secondary transition-colors flex items-center justify-between ${
                selectedRecipe?.name === recipe.name ? 'bg-secondary' : ''
              } disabled:opacity-50`}
            >
              <div>
                <span className="text-sm font-mono text-accent">
                  {recipe.name}
                </span>
                {recipe.args && (
                  <span className="text-xs text-dim ml-2">
                    {recipe.args}
                  </span>
                )}
                {recipe.description && (
                  <div className="text-xs text-dim mt-0.5">
                    {recipe.description}
                  </div>
                )}
              </div>
              <span className="text-xs text-dim">
                {isRunning && selectedRecipe?.name === recipe.name ? 'running...' : 'run'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Args Input */}
      {selectedRecipe?.args && (
        <div className="px-4 py-2 border-b border-subtle">
          <label className="text-xs text-dim">args:</label>
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder={selectedRecipe.args}
            className="w-full mt-1 px-2 py-1 text-sm bg-primary border border-subtle focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* Output */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 text-xs text-dim border-b border-subtle flex items-center justify-between">
          <span>// output</span>
          {output && (
            <button
              onClick={() => setOutput('')}
              className="text-dim hover:text-[var(--color-text-primary)]"
            >
              clear
            </button>
          )}
        </div>
        <pre
          ref={outputRef}
          className="flex-1 p-4 text-xs font-mono overflow-auto bg-primary whitespace-pre-wrap"
        >
          {output || '// run a recipe to see output'}
        </pre>
      </div>
    </div>
  );
}
