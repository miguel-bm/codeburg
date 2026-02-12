import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';

export function useWorkspaceGit() {
  const { api, scopeType, scopeId } = useWorkspace();
  const queryClient = useQueryClient();

  const statusKey = ['workspace-git-status', scopeType, scopeId];
  const baseDiffKey = ['workspace-git-basediff', scopeType, scopeId];

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

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: statusKey });
    queryClient.invalidateQueries({ queryKey: baseDiffKey });
  };

  const diffQuery = (opts?: { file?: string; staged?: boolean; base?: boolean }) =>
    api.git.diff(opts);

  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.git.stage(files),
    onSuccess: invalidateStatus,
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.git.unstage(files),
    onSuccess: invalidateStatus,
  });

  const revertMutation = useMutation({
    mutationFn: (payload: { tracked?: string[]; untracked?: string[] }) =>
      api.git.revert(payload),
    onSuccess: invalidateStatus,
  });

  const commitMutation = useMutation({
    mutationFn: ({ message, amend }: { message: string; amend?: boolean }) =>
      api.git.commit(message, amend),
    onSuccess: invalidateStatus,
  });

  const pullMutation = useMutation({
    mutationFn: () => api.git.pull(),
    onSuccess: invalidateStatus,
  });

  const pushMutation = useMutation({
    mutationFn: () => api.git.push(),
    onSuccess: invalidateStatus,
  });

  const stashMutation = useMutation({
    mutationFn: (action: 'push' | 'pop' | 'list') => api.git.stash(action),
    onSuccess: invalidateStatus,
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
