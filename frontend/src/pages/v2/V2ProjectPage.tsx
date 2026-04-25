import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CircleSlash,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Hammer,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { TerminalSession, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { TerminalView } from '../../components/session/TerminalView';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { FileExplorer } from '../../components/workspace/FileExplorer';
import { FileSearchPanel } from '../../components/workspace/FileSearchPanel';
import { GitPanel } from '../../components/workspace/GitPanel';
import { EditorTab } from '../../components/workspace/EditorTab';
import { DiffTab } from '../../components/workspace/DiffTab';
import { fileName } from '../../components/workspace/editorUtils';
import { useWorkspaceStore, type WorkspaceTab } from '../../stores/workspace';

type HelperTab = 'files' | 'search' | 'git';

export function V2ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const resetWorkspaceTabs = useWorkspaceStore((state) => state.resetTabs);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [helperTab, setHelperTab] = useState<HelperTab>('files');
  const [composerMode, setComposerMode] = useState<'create' | 'fork' | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceBaseBranch, setWorkspaceBaseBranch] = useState('');

  const workspacesQueryKey = ['v2-workspaces', id] as const;
  const requestedWorkspaceId = searchParams.get('workspace');
  const requestedTerminalId = searchParams.get('terminal');

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: workspaces } = useQuery({
    queryKey: workspacesQueryKey,
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });

  const activeWorkspaceId = selectedWorkspaceId ?? workspaces?.[0]?.id ?? null;
  const activeWorkspace = workspaces?.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces?.[0] ?? null;

  useEffect(() => {
    resetWorkspaceTabs();
  }, [activeWorkspaceId, resetWorkspaceTabs]);

  const { data: terminals } = useQuery({
    queryKey: ['v2-terminals', activeWorkspaceId],
    queryFn: () => v2Api.listTerminals(activeWorkspaceId!),
    enabled: !!activeWorkspaceId,
    refetchInterval: 5000,
  });

  const activeTerminalId = selectedTerminalId ?? terminals?.[0]?.id ?? null;
  const activeTerminal = terminals?.find((terminal) => terminal.id === activeTerminalId) ?? terminals?.[0] ?? null;

  const createTerminal = useMutation({
    mutationFn: () => v2Api.createTerminal(activeWorkspaceId!, {}),
    onSuccess: async (terminal) => {
      setSelectedTerminalId(terminal.id);
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', activeWorkspaceId] });
    },
  });

  const stopTerminal = useMutation({
    mutationFn: (terminalId: string) => v2Api.deleteTerminal(terminalId),
    onSuccess: async (_, terminalId) => {
      if (selectedTerminalId === terminalId) setSelectedTerminalId(null);
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', activeWorkspaceId] });
    },
  });

  const createWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) => v2Api.createWorkspace(id!, input),
    onSuccess: async (response) => {
      clearComposer();
      setSelectedWorkspaceId(response.workspace.id);
      setSelectedTerminalId(null);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const forkWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) =>
      v2Api.forkWorkspace(activeWorkspaceId!, input),
    onSuccess: async (response) => {
      clearComposer();
      setSelectedWorkspaceId(response.workspace.id);
      setSelectedTerminalId(null);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const deleteWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      if (selectedWorkspaceId === workspaceId) {
        setSelectedWorkspaceId(null);
        setSelectedTerminalId(null);
      }
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const mutateWorkspaceStatus = useMutation({
    mutationFn: async ({ workspaceId, action }: { workspaceId: string; action: 'activate' | 'merge' | 'abandon' | 'archive' }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspaceId);
      if (action === 'merge') return v2Api.mergeWorkspace(workspaceId);
      if (action === 'abandon') return v2Api.abandonWorkspace(workspaceId);
      return v2Api.archiveWorkspace(workspaceId);
    },
    onSuccess: async (workspace) => {
      if (workspace.status !== 'active') setSelectedTerminalId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['v2-terminals', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] }),
      ]);
    },
  });

  const syncWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.syncWorkspace(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  useEffect(() => {
    if (composerMode === 'create') {
      setWorkspaceBaseBranch(project?.defaultBranch ?? activeWorkspace?.branchName ?? 'main');
      setWorkspaceName('');
    }
    if (composerMode === 'fork') {
      setWorkspaceBaseBranch(activeWorkspace?.branchName ?? project?.defaultBranch ?? 'main');
      setWorkspaceName(activeWorkspace ? `${activeWorkspace.name} fork` : '');
    }
  }, [composerMode, activeWorkspace, project]);

  useEffect(() => {
    if (!workspaces?.length) return;
    if (requestedWorkspaceId && workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) {
      setSelectedWorkspaceId((current) => current ?? requestedWorkspaceId);
    }
  }, [requestedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!terminals?.length) return;
    if (requestedTerminalId && terminals.some((terminal) => terminal.id === requestedTerminalId)) {
      setSelectedTerminalId((current) => current ?? requestedTerminalId);
    }
  }, [requestedTerminalId, terminals]);

  const clearComposer = () => {
    setComposerMode(null);
    setWorkspaceName('');
    setWorkspaceBaseBranch('');
  };

  const submitWorkspaceComposer = () => {
    const payload = {
      name: workspaceName.trim(),
      baseBranch: workspaceBaseBranch.trim() || undefined,
    };
    if (!payload.name) return;
    if (composerMode === 'fork') forkWorkspace.mutate(payload);
    else createWorkspace.mutate(payload);
  };

  const workspaceError =
    createWorkspace.error ?? forkWorkspace.error ?? deleteWorkspace.error ?? mutateWorkspaceStatus.error ?? syncWorkspace.error;
  const workspacePending =
    createWorkspace.isPending ||
    forkWorkspace.isPending ||
    deleteWorkspace.isPending ||
    mutateWorkspaceStatus.isPending ||
    syncWorkspace.isPending;

  const terminalDisabled = !activeWorkspaceId || activeWorkspace?.status !== 'active' || createTerminal.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{project?.name ?? 'Project'}</div>
            <div className="truncate text-xs text-dim">{project?.path}</div>
          </div>
          {activeWorkspace && <Badge variant="label" color={statusColor(activeWorkspace.status)}>{activeWorkspace.status}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {project && (
            <>
              <Button size="xs" variant="ghost" icon={<MessageSquareText size={13} />} onClick={() => navigate(`/v2/projects/${project.id}/conversations`)}>
                Conversations
              </Button>
              <Button size="xs" variant="ghost" icon={<Hammer size={13} />} onClick={() => navigate(`/v2/projects/${project.id}/skills`)}>
                Skills
              </Button>
              <Button size="xs" variant="ghost" icon={<Settings2 size={13} />} onClick={() => navigate(`/v2/projects/${project.id}/pi`)}>
                Pi
              </Button>
            </>
          )}
          <Button size="xs" variant="secondary" icon={<Plus size={13} />} onClick={() => setComposerMode('create')}>
            Worktree
          </Button>
          <Button size="xs" variant="primary" icon={<Plus size={13} />} loading={createTerminal.isPending} disabled={terminalDisabled} onClick={() => createTerminal.mutate()}>
            Terminal
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_34rem] overflow-hidden">
        <aside className="min-h-0 border-r border-[var(--color-card-border)] bg-canvas">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-[var(--color-card-border)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-dim">Workspaces</div>
                <Button size="xs" variant="ghost" icon={<GitFork size={13} />} disabled={!activeWorkspaceId} onClick={() => setComposerMode('fork')}>
                  Fork
                </Button>
              </div>
              {composerMode && (
                <Card padding="sm" className="space-y-2">
                  <input
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    placeholder={composerMode === 'fork' ? 'Fork name' : 'Workspace name'}
                    className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-primary px-2 text-sm outline-none"
                  />
                  <input
                    value={workspaceBaseBranch}
                    onChange={(event) => setWorkspaceBaseBranch(event.target.value)}
                    placeholder={project?.defaultBranch ?? 'main'}
                    className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-primary px-2 text-sm outline-none"
                  />
                  <div className="flex gap-2">
                    <Button size="xs" variant="primary" loading={workspacePending} disabled={!workspaceName.trim()} onClick={submitWorkspaceComposer}>
                      Create
                    </Button>
                    <Button size="xs" variant="ghost" onClick={clearComposer}>Cancel</Button>
                  </div>
                </Card>
              )}
              {workspaceError instanceof Error && (
                <div className="mt-2 rounded-md bg-[var(--color-error)]/10 px-2 py-1.5 text-xs text-[var(--color-error)]">
                  {workspaceError.message}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
              {(workspaces ?? []).map((workspace) => (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  active={workspace.id === activeWorkspaceId}
                  onClick={() => {
                    setSelectedWorkspaceId(workspace.id);
                    setSelectedTerminalId(null);
                  }}
                />
              ))}
            </div>

            {activeWorkspace && (
              <div className="border-t border-[var(--color-card-border)] p-2">
                <WorkspaceActions
                  workspace={activeWorkspace}
                  pending={workspacePending}
                  onSync={() => syncWorkspace.mutate(activeWorkspace.id)}
                  onMerge={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'merge' })}
                  onAbandon={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'abandon' })}
                  onReactivate={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'activate' })}
                  onArchive={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'archive' })}
                  onDelete={() => deleteWorkspace.mutate(activeWorkspace.id)}
                />
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-primary">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <SquareTerminal size={15} className="text-dim" />
              <span className="truncate">{activeTerminal?.title || 'Persistent terminal'}</span>
            </div>
            <Button size="xs" variant="secondary" icon={<Plus size={13} />} disabled={terminalDisabled} loading={createTerminal.isPending} onClick={() => createTerminal.mutate()}>
              New
            </Button>
          </div>

          {(terminals?.length ?? 0) > 0 && (
            <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-card-border)] px-2 scrollbar-none">
              {terminals?.map((terminal) => (
                <TerminalChip
                  key={terminal.id}
                  terminal={terminal}
                  active={terminal.id === activeTerminalId}
                  onSelect={() => setSelectedTerminalId(terminal.id)}
                  onClose={() => stopTerminal.mutate(terminal.id)}
                />
              ))}
            </div>
          )}

          {createTerminal.error instanceof Error && (
            <div className="border-b border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
              {createTerminal.error.message}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {activeTerminal ? (
              <TerminalView sessionId={activeTerminal.id} targetType="terminal" />
            ) : (
              <EmptyTerminal onCreate={() => createTerminal.mutate()} disabled={terminalDisabled} workspace={activeWorkspace} />
            )}
          </div>
        </section>

        <aside className="min-h-0 border-l border-[var(--color-card-border)] bg-canvas">
          {project && activeWorkspace ? (
            <WorkspaceProvider scope={{ type: 'workspace', workspaceId: activeWorkspace.id, workspace: activeWorkspace, project }}>
              <V2WorkspaceInspector helperTab={helperTab} onSelectHelperTab={setHelperTab} />
            </WorkspaceProvider>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-sm text-dim">Select a workspace</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function WorkspaceRow({ workspace, active, onClick }: { workspace: Workspace; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full rounded-lg px-3 py-2 text-left transition-colors ${
        active ? 'bg-[var(--color-card)]' : 'hover:bg-[var(--color-card)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <GitBranch size={14} className={active ? 'text-accent' : 'text-dim'} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-6 text-xs text-dim">
        <span className="truncate">{workspace.branchName}</span>
        <span>{workspace.kind}</span>
      </div>
    </button>
  );
}

function WorkspaceActions({
  workspace,
  pending,
  onSync,
  onMerge,
  onAbandon,
  onReactivate,
  onArchive,
  onDelete,
}: {
  workspace: Workspace;
  pending: boolean;
  onSync: () => void;
  onMerge: () => void;
  onAbandon: () => void;
  onReactivate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  if (workspace.kind === 'main') {
    return (
      <Button className="w-full" size="xs" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending || workspace.status !== 'active'} onClick={onSync}>
        Sync branch
      </Button>
    );
  }

  if (workspace.status !== 'active') {
    return (
      <div className="grid gap-1">
        <Button size="xs" variant="secondary" icon={<Plus size={13} />} disabled={pending} onClick={onReactivate}>
          Reactivate
        </Button>
        {workspace.status !== 'archived' && (
          <Button size="xs" variant="ghost" icon={<Archive size={13} />} disabled={pending} onClick={onArchive}>
            Archive
          </Button>
        )}
        <Button size="xs" variant="danger" icon={<Trash2 size={13} />} disabled={pending} onClick={onDelete}>
          Delete
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <Button size="xs" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending} onClick={onSync}>
        Sync
      </Button>
      <Button size="xs" variant="secondary" icon={<GitCommitHorizontal size={13} />} disabled={pending} onClick={onMerge}>
        Merge
      </Button>
      <Button size="xs" variant="ghost" icon={<CircleSlash size={13} />} disabled={pending} onClick={onAbandon}>
        Abandon
      </Button>
      <Button size="xs" variant="danger" icon={<Trash2 size={13} />} disabled={pending} onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

function TerminalChip({
  terminal,
  active,
  onSelect,
  onClose,
}: {
  terminal: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div className={`inline-flex h-6 items-center overflow-hidden rounded-md text-xs ${active ? 'bg-[var(--color-card-hover)]' : 'bg-[var(--color-card)]'}`}>
      <button type="button" onClick={onSelect} className="px-2">
        {terminal.title || terminal.id.slice(0, 8)}
      </button>
      <button type="button" onClick={onClose} className="px-1.5 text-dim hover:text-[var(--color-text-primary)]" aria-label="Close terminal">
        <X size={12} />
      </button>
    </div>
  );
}

function EmptyTerminal({ onCreate, disabled, workspace }: { onCreate: () => void; disabled: boolean; workspace: Workspace | null }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <SquareTerminal size={32} className="mx-auto mb-3 text-dim" />
        <div className="text-sm font-medium">No terminal selected</div>
        <div className="mt-2 text-xs leading-5 text-dim">
          {workspace?.status && workspace.status !== 'active'
            ? `This workspace is ${workspace.status}. Reactivate it before starting another terminal.`
            : 'Start a persistent workspace terminal and keep it alive across page reloads.'}
        </div>
        <Button className="mt-4" size="sm" variant="primary" icon={<Plus size={14} />} disabled={disabled} onClick={onCreate}>
          Start terminal
        </Button>
      </div>
    </div>
  );
}

function V2WorkspaceInspector({ helperTab, onSelectHelperTab }: { helperTab: HelperTab; onSelectHelperTab: (tab: HelperTab) => void }) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabIndex = useWorkspaceStore((state) => state.activeTabIndex);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);

  const activeTab = tabs[activeTabIndex];
  const inspectorTabs = tabs.filter((tab): tab is Extract<WorkspaceTab, { type: 'editor' | 'diff' }> => tab.type === 'editor' || tab.type === 'diff');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--color-card-border)] p-2">
        <div className="grid grid-cols-3 gap-1">
          <HelperButton active={helperTab === 'files'} icon={<Files size={14} />} onClick={() => onSelectHelperTab('files')}>Files</HelperButton>
          <HelperButton active={helperTab === 'search'} icon={<Search size={14} />} onClick={() => onSelectHelperTab('search')}>Search</HelperButton>
          <HelperButton active={helperTab === 'git'} icon={<GitCommitHorizontal size={14} />} onClick={() => onSelectHelperTab('git')}>Git</HelperButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(14rem,0.9fr)_minmax(18rem,1.1fr)]">
        <div className="min-h-0 overflow-hidden border-b border-[var(--color-card-border)]">
          {helperTab === 'files' && <FileExplorer />}
          {helperTab === 'search' && <FileSearchPanel />}
          {helperTab === 'git' && <GitPanel />}
        </div>

        <div className="min-h-0 overflow-hidden">
          {inspectorTabs.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-[var(--color-card-border)] px-2 scrollbar-none">
                {inspectorTabs.map((tab) => {
                  const index = tabs.findIndex((candidate) => candidate === tab);
                  const active = index === activeTabIndex;
                  return (
                    <button
                      key={previewTabKey(tab, index)}
                      type="button"
                      onClick={() => setActiveTab(index)}
                      className={`inline-flex h-6 max-w-[12rem] items-center gap-1.5 rounded-md px-2 text-xs ${
                        active ? 'bg-[var(--color-card-hover)]' : 'bg-[var(--color-card)] hover:bg-[var(--color-card-hover)]'
                      }`}
                    >
                      <span className="truncate">{previewTabLabel(tab)}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(index);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeTab(index);
                          }
                        }}
                      >
                        <X size={11} />
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab?.type === 'editor' && <EditorTab path={activeTab.path} line={activeTab.line} />}
                {activeTab?.type === 'diff' && <DiffTab file={activeTab.file} staged={activeTab.staged} base={activeTab.base} commit={activeTab.commit} />}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-5 text-center text-xs text-dim">
              Open a file or diff to preview it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HelperButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors ${
        active ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'text-dim hover:bg-[var(--color-card)]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function previewTabKey(tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>, index: number) {
  if (tab.type === 'editor') return `editor:${tab.path}:${index}`;
  return `diff:${tab.file ?? 'all'}:${tab.staged}:${tab.base}:${tab.commit ?? 'none'}:${index}`;
}

function previewTabLabel(tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>) {
  if (tab.type === 'editor') return fileName(tab.path);
  if (tab.file) return fileName(tab.file);
  if (tab.commit) return tab.commit.slice(0, 7);
  return 'All changes';
}

function statusColor(status: Workspace['status']): 'blue' | 'green' | 'yellow' | 'gray' {
  if (status === 'active') return 'blue';
  if (status === 'merged') return 'green';
  if (status === 'abandoned') return 'yellow';
  return 'gray';
}
