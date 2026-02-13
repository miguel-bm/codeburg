import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';
import type { StartSessionInput } from '../api/sessions';
import { sessionsApi } from '../api/sessions';

export function useWorkspaceSessions() {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const queryKey = ['workspace-sessions', scopeType, scopeId];

  const sessionsQuery = useQuery({
    queryKey,
    queryFn: () => api.sessions.list(),
    refetchInterval: 30_000, // Fallback — real-time via WebSocket sidebar_update
  });

  const startMutation = useMutation({
    mutationFn: (input: StartSessionInput) => api.sessions.start(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.stop(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => sessionsApi.delete(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ sessionId, content }: { sessionId: string; content: string }) =>
      sessionsApi.sendMessage(sessionId, content),
  });

  return {
    sessions: sessionsQuery.data ?? [],
    isLoading: sessionsQuery.isLoading,
    refetch: sessionsQuery.refetch,
    startSession: startMutation.mutateAsync,
    isStarting: startMutation.isPending,
    startError: startMutation.error?.message,
    stopSession: stopMutation.mutateAsync,
    deleteSession: deleteMutation.mutateAsync,
    sendMessage: sendMessageMutation.mutateAsync,
    getSession: (id: string) => sessionsApi.get(id),
  };
}

export function useSessionDetail(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}
