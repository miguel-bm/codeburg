import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sidebarApi } from '../api';
import { useSharedWebSocket } from './useSharedWebSocket';

const SIDEBAR_QUERY_KEY = ['sidebar'] as const;

export function useSidebarData() {
  return useQuery({
    queryKey: SIDEBAR_QUERY_KEY,
    queryFn: sidebarApi.get,
    refetchInterval: 60_000, // Fallback — real-time via WebSocket sidebar_update
  });
}

export function useSidebarRealtimeUpdates() {
  const queryClient = useQueryClient();

  useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type === 'sidebar_update') {
        queryClient.invalidateQueries({ queryKey: SIDEBAR_QUERY_KEY });
      }
    }, [queryClient]),
  });
}
