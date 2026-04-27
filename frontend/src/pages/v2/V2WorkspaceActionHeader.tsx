import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import type { Project, Workspace } from '../../api/types';
import { v2Api, type MergeWorkspaceInput, type WorkspacePullRequest } from '../../api/v2';
import type { GitStatus } from '../../api/git';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { useWorkspaceGit } from '../../hooks/useWorkspaceGit';
import { Button, V2Input, V2Textarea } from './v2-ui';
import { V2QuickActionsMenu } from './V2QuickActionsMenu';

type WorkspaceResolveTarget = 'current' | 'new';

interface V2WorkspaceActionHeaderProps {
  project: Project;
  workspace: Workspace;
  pending?: boolean;
  detail?: ReactNode;
  currentConversationAvailable?: boolean;
  onUpdateFromBase: () => void;
  onMerge: (input: MergeWorkspaceInput) => void;
  onCloseWithoutMerging: () => void;
  onReactivate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onOpenGitPanel?: () => void;
  onResolveConflicts?: (target: WorkspaceResolveTarget) => void;
}

type ActionMenuName = 'update' | 'publish' | 'branch' | 'finish' | null;

export function V2WorkspaceActionHeader({
  project,
  workspace,
  pending = false,
  detail,
  currentConversationAvailable = false,
  onUpdateFromBase,
  onMerge,
  onCloseWithoutMerging,
  onReactivate,
  onArchive,
  onDelete,
  onOpenGitPanel,
  onResolveConflicts,
}: V2WorkspaceActionHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const git = useWorkspaceGit({ enabled: workspace.status === 'active' });
  const [openMenu, setOpenMenu] = useState<ActionMenuName>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [branchMode, setBranchMode] = useState<'current' | 'base' | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const status = git.status;
  const hasConflicts = Boolean(status?.hasConflicts);
  const isActive = workspace.status === 'active';
  const branchLabel = status?.branch || workspace.branchName;
  const baseBranch = workspace.baseBranch || project.defaultBranch || 'main';
  const actionDisabled = pending || !isActive || hasConflicts;

  const prQuery = useQuery({
    queryKey: ['v2-workspace-pr', workspace.id],
    queryFn: () => v2Api.getWorkspacePullRequest(workspace.id),
    enabled: isActive,
    refetchInterval: 30_000,
    retry: false,
  });
  const pr = prQuery.data;

  const rebaseWorkspace = useMutation({
    mutationFn: (input: { baseBranch: string; fetch?: boolean }) => v2Api.rebaseWorkspace(workspace.id, input),
    onSuccess: async () => {
      setOperationError(null);
      await git.refetch();
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Rebase failed'),
  });

  const continueOperation = useMutation({
    mutationFn: () => v2Api.continueWorkspaceGitOperation(workspace.id),
    onSuccess: async () => {
      setOperationError(null);
      await git.refetch();
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Continue failed'),
  });

  const abortOperation = useMutation({
    mutationFn: () => v2Api.abortWorkspaceGitOperation(workspace.id),
    onSuccess: async () => {
      setOperationError(null);
      await git.refetch();
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Abort failed'),
  });

  const createPr = useMutation({
    mutationFn: (input: { title?: string; body?: string }) => v2Api.createWorkspacePullRequest(workspace.id, input),
    onSuccess: async () => {
      setOperationError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-pr', workspace.id] }),
        git.refetch(),
      ]);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'PR creation failed'),
  });

  const forkWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) => v2Api.forkWorkspace(workspace.id, input),
    onSuccess: async (response) => {
      setBranchMode(null);
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', project.id] });
      navigate(`/v2/projects/${project.id}?workspace=${response.workspace.id}`);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Workspace creation failed'),
  });

  const createPullRequest = async (title?: string) => {
    const result = await createPr.mutateAsync({ title: title || workspace.name });
    return result;
  };

  const copyPrURL = async () => {
    if (!pr?.url) return;
    await navigator.clipboard.writeText(pr.url);
  };

  const updatePending =
    pending ||
    rebaseWorkspace.isPending ||
    continueOperation.isPending ||
    abortOperation.isPending ||
    git.isPulling ||
    git.isPushing ||
    createPr.isPending ||
    forkWorkspace.isPending;

  return (
    <>
      <header className="shrink-0 bg-canvas px-3 py-2 md:px-4">
        <div className="flex min-h-10 flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
            <GitBranch size={14} className="shrink-0" />
            <span className="truncate font-medium text-[var(--color-text-primary)]">{workspace.name}</span>
            {workspace.branchName !== workspace.name && <span className="truncate">{branchLabel}</span>}
            <Badge variant="label" color={statusColor(workspace.status)}>{workspace.status}</Badge>
            {pr?.exists && pr.url && (
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] sm:inline-flex"
                title={pr.title || pr.url}
              >
                <GitPullRequest size={12} />
                PR {pr.state ? pr.state.toLowerCase() : 'open'}
              </a>
            )}
            {status && (status.ahead > 0 || status.behind > 0) && (
              <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-[11px] sm:inline-flex">
                {status.ahead > 0 ? `↑ ${status.ahead}` : null}
                {status.ahead > 0 && status.behind > 0 ? ' · ' : null}
                {status.behind > 0 ? `↓ ${status.behind}` : null}
              </span>
            )}
            {detail}
          </div>

          <div className="flex shrink-0 items-center gap-1 overflow-x-auto scrollbar-none md:overflow-visible">
            <V2QuickActionsMenu projectId={project.id} workspaceId={workspace.id} disabled={!isActive} />
            <ActionMenu
              name="Update"
              icon={<RefreshCw size={13} />}
              open={openMenu === 'update'}
              disabled={!isActive}
              pending={rebaseWorkspace.isPending || continueOperation.isPending || abortOperation.isPending || git.isPulling}
              onToggle={() => setOpenMenu(openMenu === 'update' ? null : 'update')}
              onClose={() => setOpenMenu(null)}
            >
              {hasConflicts ? (
                <>
                  <MenuNote title={`${operationLabel(status?.operation)} paused`} body={`${status?.conflicted?.length ?? 0} conflicted file${(status?.conflicted?.length ?? 0) === 1 ? '' : 's'} need review.`} />
                  <ActionMenuItem icon={<Check size={14} />} disabled={updatePending} onClick={() => { setOpenMenu(null); continueOperation.mutate(); }}>
                    Continue {operationLabel(status?.operation)}
                  </ActionMenuItem>
                  <ActionMenuItem icon={<X size={14} />} danger disabled={updatePending} onClick={() => { setOpenMenu(null); abortOperation.mutate(); }}>
                    Abort {operationLabel(status?.operation)}
                  </ActionMenuItem>
                </>
              ) : (
                <>
                  <ActionMenuItem icon={<RefreshCw size={14} />} disabled={updatePending || workspace.kind === 'main'} onClick={() => { setOpenMenu(null); onUpdateFromBase(); }}>
                    <span>Update from base</span>
                    <span className="text-[10px] text-dim">Fetch {baseBranch}, then rebase</span>
                  </ActionMenuItem>
                  <ActionMenuItem icon={<ArrowUp size={14} className="rotate-180" />} disabled={updatePending || !status?.hasUpstream} onClick={() => { setOpenMenu(null); void git.pull().catch((error) => setOperationError(error instanceof Error ? error.message : 'Pull failed')); }}>
                    <span>Pull branch</span>
                    <span className="text-[10px] text-dim">Fast-forward from upstream</span>
                  </ActionMenuItem>
                  <ActionMenuItem icon={<GitBranch size={14} />} disabled={updatePending} onClick={() => {
                    const target = window.prompt('Rebase onto branch or ref', baseBranch)?.trim();
                    if (!target) return;
                    setOpenMenu(null);
                    rebaseWorkspace.mutate({ baseBranch: target, fetch: true });
                  }}>
                    <span>Rebase onto...</span>
                    <span className="text-[10px] text-dim">Choose another branch or ref</span>
                  </ActionMenuItem>
                </>
              )}
            </ActionMenu>

            <Button
              size="xs"
              variant="secondary"
              icon={<GitCommitHorizontal size={13} />}
              disabled={!isActive || hasConflicts}
              onClick={() => setCommitOpen(true)}
            >
              Commit
            </Button>

            <ActionMenu
              name="Publish"
              icon={<Send size={13} />}
              open={openMenu === 'publish'}
              disabled={actionDisabled}
              pending={git.isPushing || createPr.isPending || prQuery.isFetching}
              onToggle={() => setOpenMenu(openMenu === 'publish' ? null : 'publish')}
              onClose={() => setOpenMenu(null)}
            >
              <ActionMenuItem icon={<ArrowUp size={14} />} disabled={updatePending} onClick={() => { setOpenMenu(null); void git.push({}).catch((error) => setOperationError(error instanceof Error ? error.message : 'Push failed')); }}>
                <span>Push branch</span>
                <span className="text-[10px] text-dim">{status?.hasUpstream ? 'Update upstream' : 'Publish upstream'}</span>
              </ActionMenuItem>
              {pr?.exists && pr.url ? (
                <>
                  <ActionMenuItem icon={<GitPullRequest size={14} />} onClick={() => { setOpenMenu(null); window.open(pr.url, '_blank', 'noopener,noreferrer'); }}>
                    <span>Open PR</span>
                    <span className="text-[10px] text-dim">{pr.title || pr.url}</span>
                  </ActionMenuItem>
                  <ActionMenuItem icon={<Copy size={14} />} onClick={() => { setOpenMenu(null); void copyPrURL(); }}>
                    Copy PR link
                  </ActionMenuItem>
                </>
              ) : (
                <ActionMenuItem icon={<GitPullRequest size={14} />} disabled={updatePending || workspace.kind === 'main'} onClick={() => { setOpenMenu(null); void createPullRequest(); }}>
                  <span>Create PR</span>
                  <span className="text-[10px] text-dim">Push branch first, then open review</span>
                </ActionMenuItem>
              )}
            </ActionMenu>

            <ActionMenu
              name="Branch"
              icon={<GitBranchPlus size={13} />}
              open={openMenu === 'branch'}
              disabled={pending}
              pending={forkWorkspace.isPending}
              onToggle={() => setOpenMenu(openMenu === 'branch' ? null : 'branch')}
              onClose={() => setOpenMenu(null)}
            >
              <ActionMenuItem icon={<GitBranchPlus size={14} />} disabled={updatePending} onClick={() => { setOpenMenu(null); setBranchMode('current'); }}>
                <span>New workspace from this branch</span>
                <span className="text-[10px] text-dim">{workspace.branchName}</span>
              </ActionMenuItem>
              <ActionMenuItem icon={<GitBranch size={14} />} disabled={updatePending} onClick={() => { setOpenMenu(null); setBranchMode('base'); }}>
                <span>New workspace from base</span>
                <span className="text-[10px] text-dim">{baseBranch}</span>
              </ActionMenuItem>
            </ActionMenu>

            <ActionMenu
              name="Finish"
              icon={<GitMerge size={13} />}
              open={openMenu === 'finish'}
              disabled={pending}
              pending={pending}
              onToggle={() => setOpenMenu(openMenu === 'finish' ? null : 'finish')}
              onClose={() => setOpenMenu(null)}
            >
              {workspace.status !== 'active' ? (
                <>
                  <ActionMenuItem icon={<RefreshCw size={14} />} disabled={pending} onClick={() => { setOpenMenu(null); onReactivate(); }}>
                    Reactivate workspace
                  </ActionMenuItem>
                  {workspace.status !== 'archived' && (
                    <ActionMenuItem icon={<Archive size={14} />} disabled={pending} onClick={() => { setOpenMenu(null); onArchive(); }}>
                      Archive
                    </ActionMenuItem>
                  )}
                  <ActionMenuItem icon={<Trash2 size={14} />} danger disabled={pending || workspace.kind === 'main'} onClick={() => { setOpenMenu(null); onDelete(); }}>
                    Delete workspace
                  </ActionMenuItem>
                </>
              ) : (
                <>
                  <ActionMenuItem icon={<GitMerge size={14} />} disabled={pending || hasConflicts || workspace.kind === 'main'} onClick={() => { setOpenMenu(null); setMergeOpen(true); }}>
                    <span>Merge...</span>
                    <span className="text-[10px] text-dim">Merge and close this workspace</span>
                  </ActionMenuItem>
                  <ActionMenuItem icon={<CircleSlash size={14} />} disabled={pending || workspace.kind === 'main'} onClick={() => {
                    setOpenMenu(null);
                    if (window.confirm(`Close "${workspace.name}" without merging? Conversations will detach and the workspace can be reactivated later.`)) onCloseWithoutMerging();
                  }}>
                    <span>Close without merging</span>
                    <span className="text-[10px] text-dim">Reversible, keeps the record</span>
                  </ActionMenuItem>
                  <ActionMenuItem icon={<Trash2 size={14} />} danger disabled={pending || workspace.kind === 'main'} onClick={() => {
                    setOpenMenu(null);
                    if (window.confirm(`Delete "${workspace.name}"? This removes the workspace record and its local branch/worktree.`)) onDelete();
                  }}>
                    <span>Delete workspace</span>
                    <span className="text-[10px] text-dim">Permanent</span>
                  </ActionMenuItem>
                </>
              )}
            </ActionMenu>
          </div>
        </div>
        {operationError && (
          <div className="mt-2 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-error)]">
            {operationError}
          </div>
        )}
      </header>

      {hasConflicts && status && (
        <ConflictBanner
          status={status}
          currentConversationAvailable={currentConversationAvailable}
          onOpenGitPanel={onOpenGitPanel}
          onResolveConflicts={onResolveConflicts}
          onContinue={() => continueOperation.mutate()}
          onAbort={() => abortOperation.mutate()}
          pending={continueOperation.isPending || abortOperation.isPending}
        />
      )}

      <CommitDialog
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        workspace={workspace}
        status={status}
        createPr={createPullRequest}
        stageFiles={git.stage}
        commitChanges={git.commit}
        pushBranch={git.push}
        pending={git.isStaging || git.isCommitting || git.isPushing || createPr.isPending}
        onDone={async () => {
          setCommitOpen(false);
          await Promise.all([
            git.refetch(),
            queryClient.invalidateQueries({ queryKey: ['v2-workspace-pr', workspace.id] }),
          ]);
        }}
        onError={setOperationError}
      />

      <BranchDialog
        open={branchMode !== null}
        mode={branchMode}
        workspace={workspace}
        project={project}
        pending={forkWorkspace.isPending}
        onClose={() => setBranchMode(null)}
        onSubmit={(input) => forkWorkspace.mutate(input)}
      />

      <MergeDialog
        open={mergeOpen}
        workspace={workspace}
        baseBranch={baseBranch}
        pending={pending}
        onClose={() => setMergeOpen(false)}
        onSubmit={(input) => {
          setMergeOpen(false);
          onMerge(input);
        }}
      />
    </>
  );
}

function ActionMenu({
  name,
  icon,
  open,
  disabled,
  pending,
  children,
  onToggle,
  onClose,
}: {
  name: string;
  icon: ReactNode;
  open: boolean;
  disabled?: boolean;
  pending?: boolean;
  children: ReactNode;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative">
      <Button
        size="xs"
        variant="secondary"
        icon={pending ? <Loader2 size={13} className="animate-spin" /> : icon}
        iconRight={<ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
        disabled={disabled}
        onClick={onToggle}
      >
        {name}
      </Button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label={`Close ${name} menu`} onClick={onClose} />
          <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 max-h-[min(30rem,calc(100dvh-96px))] overflow-auto rounded-xl border border-subtle bg-card p-1.5 shadow-[var(--shadow-card)] md:absolute md:inset-auto md:right-0 md:top-8 md:w-72">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function ActionMenuItem({
  icon,
  danger,
  disabled,
  children,
  onClick,
}: {
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-45 ${
        danger
          ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
          : 'text-[var(--color-text-secondary)] hover:bg-secondary hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-dim">{icon}</span>
      <span className="min-w-0 flex flex-1 flex-col">{children}</span>
    </button>
  );
}

function MenuNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-1 rounded-lg bg-inset px-3 py-2">
      <div className="text-xs font-medium text-[var(--color-text-primary)]">{title}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-dim">{body}</div>
    </div>
  );
}

function ConflictBanner({
  status,
  currentConversationAvailable,
  pending,
  onOpenGitPanel,
  onResolveConflicts,
  onContinue,
  onAbort,
}: {
  status: GitStatus;
  currentConversationAvailable: boolean;
  pending: boolean;
  onOpenGitPanel?: () => void;
  onResolveConflicts?: (target: WorkspaceResolveTarget) => void;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const count = status.conflicted?.length ?? 0;
  return (
    <div className="shrink-0 border-y border-[var(--color-warning)]/25 bg-[var(--color-warning)]/10 px-3 py-2 md:px-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <ShieldAlert size={16} className="shrink-0 text-[var(--color-warning)]" />
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--color-text-primary)]">
              {operationLabel(status.operation)} paused with {count} conflicted file{count === 1 ? '' : 's'}
            </div>
            <div className="truncate text-xs text-dim">
              {status.conflicted?.slice(0, 3).map((file) => file.path).join(', ') || 'Resolve conflicts, stage files, then continue.'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {onOpenGitPanel && <Button size="xs" variant="ghost" onClick={onOpenGitPanel}>Open conflicts</Button>}
          {onResolveConflicts && currentConversationAvailable && (
            <Button size="xs" variant="secondary" icon={<GitCommitHorizontal size={13} />} disabled={pending} onClick={() => onResolveConflicts('current')}>
              Send to this chat
            </Button>
          )}
          {onResolveConflicts && (
            <Button size="xs" variant="secondary" icon={<GitBranchPlus size={13} />} disabled={pending} onClick={() => onResolveConflicts('new')}>
              New conflict chat
            </Button>
          )}
          <Button size="xs" variant="primary" icon={<Check size={13} />} loading={pending} onClick={onContinue}>Continue</Button>
          <Button size="xs" variant="ghost" icon={<X size={13} />} disabled={pending} onClick={onAbort}>Abort</Button>
        </div>
      </div>
    </div>
  );
}

function CommitDialog({
  open,
  onClose,
  workspace,
  status,
  pending,
  stageFiles,
  commitChanges,
  pushBranch,
  createPr,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  status?: GitStatus;
  pending: boolean;
  stageFiles: (files: string[]) => Promise<unknown>;
  commitChanges: (input: { message: string; amend?: boolean }) => Promise<unknown>;
  pushBranch: (opts?: { force?: boolean }) => Promise<unknown>;
  createPr: (title?: string) => Promise<WorkspacePullRequest>;
  onDone: () => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [message, setMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [nextStep, setNextStep] = useState<'commit' | 'push' | 'pr'>('commit');
  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];
  const untracked = status?.untracked ?? [];
  const stageableFiles = useMemo(
    () => uniqueFiles([...(status?.unstaged ?? []).map((file) => file.path), ...(status?.untracked ?? [])]),
    [status],
  );
  const stats = useMemo(() => gitStats(status), [status]);
  const hasCommitInput = staged.length > 0 || (includeUnstaged && stageableFiles.length > 0);
  const canSubmit = Boolean(message.trim()) && hasCommitInput && !status?.hasConflicts && !pending;

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setIncludeUnstaged(true);
    setNextStep('commit');
  }, [open]);

  const submit = async () => {
    if (!canSubmit) return;
    try {
      onError(null);
      if (includeUnstaged && stageableFiles.length > 0) {
        await stageFiles(stageableFiles);
      }
      await commitChanges({ message: message.trim() });
      if (nextStep === 'push' || nextStep === 'pr') {
        await pushBranch({});
      }
      if (nextStep === 'pr') {
        await createPr(message.trim());
      }
      await onDone();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Commit failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Commit changes"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-dim">{hasCommitInput ? `${changeCount(status)} change${changeCount(status) === 1 ? '' : 's'} ready` : 'No changes selected'}</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" loading={pending} disabled={!canSubmit} onClick={() => void submit()}>
              Continue
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <InfoRow label="Branch" value={status?.branch || workspace.branchName} icon={<GitBranch size={15} />} />
          <InfoRow label="Changes" value={`${changeCount(status)} files  +${stats.additions} -${stats.deletions}`} />
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Include unstaged</span>
          <button
            type="button"
            aria-pressed={includeUnstaged}
            onClick={() => setIncludeUnstaged((value) => !value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${includeUnstaged ? 'bg-accent' : 'bg-secondary'}`}
          >
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${includeUnstaged ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </label>

        <label className="block">
          <div className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>Commit message</span>
            <span className="text-xs font-normal text-dim">Required</span>
          </div>
          <V2Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe the change"
            className="min-h-24 w-full resize-none rounded-xl bg-primary text-base md:text-sm"
          />
        </label>

        <div>
          <div className="mb-2 text-sm font-medium">Next step</div>
          <div className="overflow-hidden rounded-xl border border-subtle">
            <StepChoice icon={<GitCommitHorizontal size={16} />} label="Commit" selected={nextStep === 'commit'} onClick={() => setNextStep('commit')} />
            <StepChoice icon={<ArrowUp size={16} />} label="Commit & push" selected={nextStep === 'push'} onClick={() => setNextStep('push')} />
            <StepChoice icon={<GitPullRequest size={16} />} label="Commit, push & create PR" selected={nextStep === 'pr'} onClick={() => setNextStep('pr')} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ChangeList title="Staged" files={staged.map((file) => ({ path: file.path, status: file.status }))} empty="No staged changes" />
          <ChangeList
            title={includeUnstaged ? 'Will stage' : 'Unstaged'}
            files={[...unstaged.map((file) => ({ path: file.path, status: file.status })), ...untracked.map((path) => ({ path, status: '?' }))]}
            empty="No unstaged changes"
          />
        </div>
      </div>
    </Modal>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span className="flex min-w-0 items-center gap-2 font-mono text-[var(--color-text-primary)]">
        {icon}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function StepChoice({ icon, label, selected, onClick }: { icon: ReactNode; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-12 w-full items-center gap-3 border-b border-subtle px-4 text-left last:border-b-0 hover:bg-secondary">
      <span className="text-dim">{icon}</span>
      <span className="flex-1 text-sm text-[var(--color-text-primary)]">{label}</span>
      {selected && <Check size={17} className="text-[var(--color-text-primary)]" />}
    </button>
  );
}

function ChangeList({ title, files, empty }: { title: string; files: Array<{ path: string; status: string }>; empty: string }) {
  const visible = files.slice(0, 6);
  return (
    <div className="rounded-xl bg-inset p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-dim">
        <span>{title}</span>
        <span>{files.length}</span>
      </div>
      <div className="space-y-1">
        {visible.map((file) => (
          <div key={`${file.status}:${file.path}`} className="flex items-center gap-2 text-xs">
            <span className="w-4 shrink-0 font-mono text-dim">{file.status}</span>
            <span className="min-w-0 truncate font-mono text-[var(--color-text-secondary)]">{file.path}</span>
          </div>
        ))}
        {files.length === 0 && <div className="text-xs text-dim">{empty}</div>}
        {files.length > visible.length && <div className="text-xs text-dim">+{files.length - visible.length} more</div>}
      </div>
    </div>
  );
}

function BranchDialog({
  open,
  mode,
  workspace,
  project,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'current' | 'base' | null;
  workspace: Workspace;
  project: Project;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; baseBranch?: string }) => void;
}) {
  const baseBranch = mode === 'base' ? project.defaultBranch || 'main' : workspace.branchName;
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open || !mode) return;
    setName(mode === 'base' ? `${workspace.name} from base` : `${workspace.name} branch`);
  }, [mode, open, workspace.name]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New workspace"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" loading={pending} disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), baseBranch })}>
            Create
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Name</span>
          <V2Input value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
        </label>
        <InfoRow label="Base" value={baseBranch} icon={<GitBranch size={15} />} />
      </div>
    </Modal>
  );
}

function MergeDialog({
  open,
  workspace,
  baseBranch,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  workspace: Workspace;
  baseBranch: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: MergeWorkspaceInput) => void;
}) {
  const [targetBranch, setTargetBranch] = useState(baseBranch);
  const [strategy, setStrategy] = useState('merge');
  const [pushAfterMerge, setPushAfterMerge] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetBranch(baseBranch);
    setStrategy('merge');
    setPushAfterMerge(false);
  }, [baseBranch, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Merge workspace"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            disabled={!targetBranch.trim()}
            onClick={() => onSubmit({
              targetBranch: targetBranch.trim(),
              mergeStrategy: strategy,
              syncFirst: true,
              cleanupWorktree: true,
              pushAfterMerge,
            })}
          >
            Merge and close
          </Button>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="rounded-xl bg-inset px-3 py-2 text-sm leading-5 text-[var(--color-text-secondary)]">
          Merge <span className="font-mono text-[var(--color-text-primary)]">{workspace.branchName}</span> into the target branch, then close this workspace.
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Target branch</span>
          <V2Input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} className="w-full font-mono" />
        </label>
        <div>
          <div className="mb-2 text-sm font-medium">Strategy</div>
          <div className="grid grid-cols-3 gap-2">
            {['merge', 'squash', 'rebase'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStrategy(item)}
                className={`h-9 rounded-md border text-sm capitalize ${strategy === item ? 'border-accent bg-accent/10 text-[var(--color-text-primary)]' : 'border-subtle text-[var(--color-text-secondary)] hover:bg-secondary'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Push target after merge</span>
          <button
            type="button"
            aria-pressed={pushAfterMerge}
            onClick={() => setPushAfterMerge((value) => !value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${pushAfterMerge ? 'bg-accent' : 'bg-secondary'}`}
          >
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${pushAfterMerge ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </label>
      </div>
    </Modal>
  );
}

function gitStats(status?: GitStatus) {
  const files = [...(status?.staged ?? []), ...(status?.unstaged ?? [])];
  return files.reduce((acc, file) => ({
    additions: acc.additions + (file.additions ?? 0),
    deletions: acc.deletions + (file.deletions ?? 0),
  }), { additions: 0, deletions: 0 });
}

function changeCount(status?: GitStatus) {
  if (!status) return 0;
  return uniqueFiles([
    ...status.staged.map((file) => file.path),
    ...status.unstaged.map((file) => file.path),
    ...status.untracked,
    ...(status.conflicted ?? []).map((file) => file.path),
  ]).length;
}

function uniqueFiles(files: string[]) {
  return Array.from(new Set(files.filter(Boolean)));
}

function operationLabel(operation?: string) {
  if (operation === 'rebase') return 'Rebase';
  if (operation === 'merge') return 'Merge';
  if (operation === 'cherry-pick') return 'Cherry-pick';
  return 'Git operation';
}

function statusColor(status: Workspace['status']) {
  if (status === 'active') return 'green';
  if (status === 'merged') return 'blue';
  if (status === 'abandoned') return 'yellow';
  return 'gray';
}
