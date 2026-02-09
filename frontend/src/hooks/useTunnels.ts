import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tunnelsApi } from '../api';
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

  const createMutation = useMutation({
    mutationFn: (p: number) => tunnelsApi.create(taskId, p),
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
    port,
    setPort,
    showCreate,
    setShowCreate,
    createMutation,
    stopMutation,
    copied,
    copyUrl,
    handleCreate,
  };
}
