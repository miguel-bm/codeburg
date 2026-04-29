import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import { portsApi } from '../api/ports';

export function useWorkspaceTunnels() {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const queryKey = ['workspace-tunnels', scopeType, scopeId];
  const suggestionsKey = ['workspace-port-suggestions', scopeType, scopeId];
  const enabled = scopeType === 'workspace';

  const tunnelsQuery = useQuery({
    queryKey,
    queryFn: () => api.tunnels.list(),
    enabled,
    refetchInterval: 10000,
  });

  const suggestionsQuery = useQuery({
    queryKey: suggestionsKey,
    queryFn: () => portsApi.listWorkspaceSuggestions(scopeId),
    enabled,
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (port: number) => api.tunnels.create(port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: suggestionsKey });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: suggestionsKey });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (tunnelId: string) => api.tunnels.stop(tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: suggestionsKey });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => portsApi.scanWorkspacePorts(scopeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: suggestionsKey });
    },
  });

  return {
    tunnels: tunnelsQuery.data ?? [],
    suggestions: suggestionsQuery.data?.suggestions ?? [],
    isLoading: tunnelsQuery.isLoading,
    suggestionsLoading: suggestionsQuery.isLoading,
    refetch: tunnelsQuery.refetch,
    createTunnel: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
    stopTunnel: stopMutation.mutateAsync,
    isStopping: stopMutation.isPending,
    scanPorts: scanMutation.mutateAsync,
    isScanning: scanMutation.isPending,
    scanError: scanMutation.error,
    enabled,
  };
}
