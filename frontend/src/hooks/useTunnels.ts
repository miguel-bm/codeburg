import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portsApi, tunnelsApi } from '../api';
import { useCopyToClipboard } from './useCopyToClipboard';

export function useTunnels(taskId: string) {
  const queryClient = useQueryClient();
  const [port, setPort] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: tunnels, isLoading } = useQuery({
    queryKey: ['tunnels', taskId],
    queryFn: () => tunnelsApi.list(taskId),
    refetchInterval: 10000,
  });

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['port-suggestions', taskId],
    queryFn: () => portsApi.listTaskSuggestions(taskId),
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (p: number) => tunnelsApi.create(taskId, p),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', taskId] });
      setPort('');
      setShowCreate(false);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', taskId] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (tunnelId: string) => tunnelsApi.stop(tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', taskId] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => portsApi.scanTaskPorts(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['port-suggestions', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tunnels', taskId] });
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
