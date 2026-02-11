import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import { tunnelsApi } from '../api/tunnels';

export function useWorkspaceTunnels() {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const queryKey = ['workspace-tunnels', scopeType, scopeId];

  const tunnelsQuery = useQuery({
    queryKey,
    queryFn: () => api.tunnels.list(),
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (port: number) => api.tunnels.create(port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (tunnelId: string) => tunnelsApi.stop(tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    tunnels: tunnelsQuery.data ?? [],
    isLoading: tunnelsQuery.isLoading,
    refetch: tunnelsQuery.refetch,
    createTunnel: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    stopTunnel: stopMutation.mutateAsync,
  };
}
