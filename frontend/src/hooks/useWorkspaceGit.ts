import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';

export function useWorkspaceGit() {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const statusKey = ['workspace-git-status', scopeType, scopeId];
  const baseDiffKey = ['workspace-git-basediff', scopeType, scopeId];
  const logKey = ['workspace-git-log', scopeType, scopeId];

  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () => api.git.status(),
    refetchInterval: 5000,
  });

  const baseDiffQuery = useQuery({
    queryKey: baseDiffKey,
    queryFn: () => api.git.diff({ base: true }),
    refetchInterval: 5000,
  });

  const logQuery = useQuery({
    queryKey: logKey,
    queryFn: () => api.git.log(20),
    refetchInterval: 10000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: statusKey });
    queryClient.invalidateQueries({ queryKey: baseDiffKey });
    queryClient.invalidateQueries({ queryKey: logKey });
  };

  const diffQuery = (opts?: { file?: string; staged?: boolean; base?: boolean }) =>
    api.git.diff(opts);

  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.git.stage(files),
    onSuccess: invalidateAll,
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.git.unstage(files),
    onSuccess: invalidateAll,
  });

  const revertMutation = useMutation({
    mutationFn: (payload: { tracked?: string[]; untracked?: string[] }) =>
      api.git.revert(payload),
    onSuccess: invalidateAll,
  });

  const commitMutation = useMutation({
    mutationFn: ({ message, amend }: { message: string; amend?: boolean }) =>
      api.git.commit(message, amend),
    onSuccess: invalidateAll,
  });

  const pullMutation = useMutation({
    mutationFn: () => api.git.pull(),
    onSuccess: invalidateAll,
  });

  const pushMutation = useMutation({
    mutationFn: (opts?: { force?: boolean }) => api.git.push(opts),
    onSuccess: invalidateAll,
  });

  const stashMutation = useMutation({
    mutationFn: (action: 'push' | 'pop' | 'list') => api.git.stash(action),
    onSuccess: invalidateAll,
  });

  // Combined error: first non-null mutation error
  const error =
    stageMutation.error ||
    unstageMutation.error ||
    commitMutation.error ||
    stashMutation.error ||
    revertMutation.error ||
    pullMutation.error ||
    pushMutation.error;

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    refetch: statusQuery.refetch,
    getDiff: diffQuery,
    baseDiff: baseDiffQuery.data,
    log: logQuery.data,

    stage: stageMutation.mutateAsync,
    unstage: unstageMutation.mutateAsync,
    revert: revertMutation.mutateAsync,
    commit: commitMutation.mutateAsync,
    pull: pullMutation.mutateAsync,
    push: pushMutation.mutateAsync,
    stash: stashMutation.mutateAsync,

    isCommitting: commitMutation.isPending,
    isPulling: pullMutation.isPending,
    isPushing: pushMutation.isPending,
    isStashing: stashMutation.isPending,
    isStaging: stageMutation.isPending,
    isUnstaging: unstageMutation.isPending,
    isReverting: revertMutation.isPending,

    error,
    stageError: stageMutation.error,
    unstageError: unstageMutation.error,
    commitError: commitMutation.error,
    stashError: stashMutation.error,
    revertError: revertMutation.error,
    pullError: pullMutation.error,
    pushError: pushMutation.error,
    clearErrors: () => {
      stageMutation.reset();
      unstageMutation.reset();
      commitMutation.reset();
      stashMutation.reset();
      revertMutation.reset();
      pullMutation.reset();
      pushMutation.reset();
    },
  };
}
