import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';

export function useWorkspaceRecipes() {
  const { api, scopeType, scopeId } = useWorkspace();

  const queryKey = ['workspace-recipes', scopeType, scopeId];

  const recipesQuery = useQuery({
    queryKey,
    queryFn: () => api.recipes.list(),
  });

  return {
    recipes: recipesQuery.data?.recipes ?? [],
    sources: recipesQuery.data?.sources ?? [],
    isLoading: recipesQuery.isLoading,
    refetch: recipesQuery.refetch,
    runRecipe: (recipe: string) => api.recipes.run(recipe),
  };
}
