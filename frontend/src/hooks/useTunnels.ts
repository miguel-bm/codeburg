import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portsApi, tunnelsApi } from '../api';
import { useCopyToClipboard } from './useCopyToClipboard';

export function useTunnels(workspaceId: string) {
  const queryClient = useQueryClient();
  const [port, setPort] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: tunnels, isLoading } = useQuery({
    queryKey: ['tunnels', workspaceId],
    queryFn: () => tunnelsApi.list(workspaceId),
    refetchInterval: 10000,
  });

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['port-suggestions', workspaceId],
    queryFn: () => portsApi.listWorkspaceSuggestions(workspaceId),
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (p: number) => tunnelsApi.create(workspaceId, p),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', workspaceId] });
      setPort('');
      setShowCreate(false);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', workspaceId] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (tunnelId: string) => tunnelsApi.stop(workspaceId, tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', workspaceId] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => portsApi.scanWorkspacePorts(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['tunnels', workspaceId] });
    },
  });

  const { copied, copy: copyUrl } = useCopyToClipboard();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(port, 10);
    if (portNum > 0 && portNum <= 65535) {
      createMutation.mutate(portNum);
    }
  };

  return {
    tunnels: tunnels ?? [],
    isLoading,
    suggestions: suggestions?.suggestions ?? [],
    suggestionsLoading,
    port,
    setPort,
    showCreate,
    setShowCreate,
    createMutation,
    stopMutation,
    scanMutation,
    copied,
    copyUrl,
    handleCreate,
  };
}
