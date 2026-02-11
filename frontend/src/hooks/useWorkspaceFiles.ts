import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';

export function useWorkspaceFiles(path?: string, depth?: number) {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const queryKey = ['workspace-files', scopeType, scopeId, path ?? '', depth ?? 1];

  const listQuery = useQuery({
    queryKey,
    queryFn: () => api.files.list(path, depth),
  });

  const invalidateFiles = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace-files', scopeType, scopeId] });

  const readFile = useCallback(
    (filePath: string) => api.files.read(filePath),
    [api.files],
  );

  const writeMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.files.write(path, content),
    onSuccess: invalidateFiles,
  });

  const createMutation = useMutation({
    mutationFn: ({ path, type }: { path: string; type: 'file' | 'dir' }) =>
      api.files.create(path, type),
    onSuccess: invalidateFiles,
  });

  const deleteMutation = useMutation({
    mutationFn: (path: string) => api.files.delete(path),
    onSuccess: invalidateFiles,
  });

  const renameMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api.files.rename(from, to),
    onSuccess: invalidateFiles,
  });

  const duplicateMutation = useMutation({
    mutationFn: (path: string) => api.files.duplicate(path),
    onSuccess: invalidateFiles,
  });

  const downloadFile = useCallback(
    async (filePath: string) => {
      const result = await api.files.read(filePath);
      if (result.binary) return;
      const blob = new Blob([result.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop() || filePath;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [api.files],
  );

  const searchMutation = useMutation({
    mutationFn: ({ query, regex, caseSensitive, maxResults }: {
      query: string;
      regex?: boolean;
      caseSensitive?: boolean;
      maxResults?: number;
    }) => api.files.search(query, { regex, caseSensitive, maxResults }),
  });

  return {
    files: listQuery.data?.entries ?? [],
    isLoading: listQuery.isLoading,
    refetch: listQuery.refetch,
    readFile,
    writeFile: writeMutation.mutateAsync,
    createEntry: createMutation.mutateAsync,
    deleteEntry: deleteMutation.mutateAsync,
    renameEntry: renameMutation.mutateAsync,
    duplicateEntry: duplicateMutation.mutateAsync,
    downloadFile,
    search: searchMutation.mutateAsync,
    searchResults: searchMutation.data?.results,
    isSearching: searchMutation.isPending,
    invalidateFiles,
  };
}
