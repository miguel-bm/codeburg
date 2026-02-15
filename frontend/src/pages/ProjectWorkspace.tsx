import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, GitBranch, Maximize2, Minimize2, RefreshCw, Settings, Upload, X } from 'lucide-react';
import { useSetHeader } from '../components/layout/Header';
import { OpenInEditorButton } from '../components/common/OpenInEditorButton';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Modal } from '../components/ui/Modal';
import { ActionToast } from '../components/ui/ActionToast';
import { WorkspaceProvider, Workspace } from '../components/workspace';
import type { WorkspaceScope } from '../components/workspace';
import { projectsApi } from '../api';
import { useHoverTooltip } from '../hooks/useHoverTooltip';
import { usePanelNavigation } from '../hooks/usePanelNavigation';

function getRemoteInfo(gitOrigin?: string): { name: string; url: string; icon: React.ReactNode } | null {
  if (!gitOrigin) return null;
  // Normalize git@ SSH URLs to HTTPS for the browser link
  let url = gitOrigin.trim().replace(/\.git$/, '');
  if (url.startsWith('git@')) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('github')) {
      return { name: 'GitHub', url, icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      )};
    }
    if (hostname.includes('gitlab')) {
      return { name: 'GitLab', url, icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 14.5L10.7 5.8H5.3L8 14.5z"/><path d="M8 14.5L5.3 5.8H1.1L8 14.5z" opacity=".7"/><path d="M1.1 5.8L.1 8.9c-.1.3 0 .6.3.8L8 14.5 1.1 5.8z" opacity=".5"/><path d="M1.1 5.8H5.3L3.5.5c-.1-.2-.4-.2-.5 0L1.1 5.8z"/><path d="M8 14.5l2.7-8.7h4.2L8 14.5z" opacity=".7"/><path d="M14.9 5.8l1 3.1c.1.3 0 .6-.3.8L8 14.5l6.9-8.7z" opacity=".5"/><path d="M14.9 5.8h-4.2L12.5.5c.1-.2.4-.2.5 0l1.9 5.3z"/></svg>
      )};
    }
    if (hostname.includes('bitbucket')) {
      return { name: 'Bitbucket', url, icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M.778 1.213a.768.768 0 00-.768.892l2.17 13.095a1.045 1.045 0 001.032.886h9.916a.768.768 0 00.768-.649l2.17-13.332a.768.768 0 00-.768-.892H.778zm9.098 9.52H6.164l-.796-4.153h5.326l-.818 4.153z"/></svg>
      )};
    }
    // Generic git host — show a generic external link
    return { name: hostname, url, icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14"><path d="M6 3H3v10h10v-3M9 2h5v5M8 8l6-6"/></svg>
    )};
  } catch {
    return null;
  }
}

export function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isExpanded, toggleExpanded, navigateToPanel, closePanel } = usePanelNavigation();
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const syncDefaultBranchMutation = useMutation({
    mutationFn: () => projectsApi.syncDefaultBranch(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      setFeedback({
        type: 'success',
        message: data.updated
          ? `Updated local ${data.branch} from ${data.remote}.`
          : `Local ${data.branch} is already up to date with ${data.remote}.`,
      });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update local branch' });
    },
  });

  const pushDefaultBranchMutation = useMutation({
    mutationFn: () => projectsApi.pushDefaultBranch(id!),
    onSuccess: (data) => {
      const branch = project?.defaultBranch || data.branch || 'main';
      const remote = `origin/${branch}`;
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      setShowPushConfirm(false);
      setFeedback({
        type: 'success',
        message: data.updated
          ? `Pushed ${branch} to ${remote}.`
          : `${remote} was already up to date.`,
      });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to push default branch' });
    },
  });

  const remoteInfo = project ? getRemoteInfo(project.gitOrigin) : null;
  const defaultBranch = project?.defaultBranch || 'main';
  const syncTooltipTitle = useMemo(() => `Update local ${defaultBranch}`, [defaultBranch]);
  const syncTooltipLines = useMemo(() => ([
    'Fetches latest refs from origin',
    `Fast-forwards local ${defaultBranch} to origin/${defaultBranch}`,
    'Does not push any commits',
  ]), [defaultBranch]);
  const pushTooltipTitle = useMemo(() => `Push ${defaultBranch} to origin`, [defaultBranch]);
  const pushTooltipLines = useMemo(() => ([
    `Pushes local ${defaultBranch} to origin/${defaultBranch}`,
    'Can be rejected by branch protection/non-fast-forward',
    'Opens a confirmation dialog first',
  ]), [defaultBranch]);
  const {
    tooltip: syncTooltip,
    handleMouseEnter: handleSyncEnter,
    handleMouseLeave: handleSyncLeave,
  } = useHoverTooltip();
  const {
    tooltip: pushTooltip,
    handleMouseEnter: handlePushEnter,
    handleMouseLeave: handlePushLeave,
  } = useHoverTooltip();

  useSetHeader(
    project ? (
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-3 min-w-0">
          <Breadcrumb items={[{ label: project.name }]} />
          <span className="items-center gap-1 text-xs text-dim font-mono min-w-0 hidden sm:flex" title={project.defaultBranch || 'main'}>
            <GitBranch size={11} className="shrink-0" />
            <span className="truncate">{defaultBranch}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {remoteInfo && (
            <IconButton
              icon={remoteInfo.icon}
              onClick={() => window.open(remoteInfo.url, '_blank', 'noopener')}
              tooltip={`Open on ${remoteInfo.name}`}
            />
          )}
          <OpenInEditorButton worktreePath={project.path} />
          <Button
            variant="secondary"
            size="xs"
            icon={<RefreshCw size={13} className={syncDefaultBranchMutation.isPending ? 'animate-spin' : ''} />}
            onClick={() => syncDefaultBranchMutation.mutate()}
            onMouseEnter={handleSyncEnter}
            onMouseLeave={handleSyncLeave}
            disabled={syncDefaultBranchMutation.isPending || pushDefaultBranchMutation.isPending}
          >
            <span className="hidden sm:inline">{syncDefaultBranchMutation.isPending ? 'Updating...' : `Update local ${defaultBranch}`}</span>
          </Button>
          <Button
            variant="secondary"
            size="xs"
            icon={<Upload size={13} />}
            onClick={() => {
              pushDefaultBranchMutation.reset();
              setShowPushConfirm(true);
            }}
            onMouseEnter={handlePushEnter}
            onMouseLeave={handlePushLeave}
            disabled={syncDefaultBranchMutation.isPending || pushDefaultBranchMutation.isPending}
          >
            <span className="hidden sm:inline">{pushDefaultBranchMutation.isPending ? 'Pushing...' : `Push ${defaultBranch}`}</span>
          </Button>
          <Button
            variant="secondary"
            size="xs"
            icon={<Settings size={13} />}
            onClick={() => navigateToPanel(`/projects/${project.id}/settings`)}
          >
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <IconButton
            icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            onClick={toggleExpanded}
            tooltip={isExpanded ? 'Collapse panel' : 'Expand panel'}
          />
          <IconButton
            icon={<X size={14} />}
            onClick={() => closePanel()}
            tooltip="Close panel"
          />
        </div>
      </div>
    ) : null,
    `project-workspace-${id ?? 'none'}-${project?.name ?? ''}-${syncDefaultBranchMutation.isPending}-${pushDefaultBranchMutation.isPending}-${isExpanded}-${project?.defaultBranch ?? ''}-${remoteInfo?.url ?? ''}`,
  );

  if (projectLoading) {
    return (
      <div className="h-full flex items-center justify-center text-dim">Loading...</div>
    );
  }

  if (!project || !id) {
    return (
      <div className="h-full flex items-center justify-center text-dim flex-col gap-2">
        <AlertTriangle size={32} className="text-dim" />
        Project not found
      </div>
    );
  }

  const scope: WorkspaceScope = { type: 'project', projectId: id, project };

  return (
    <WorkspaceProvider scope={scope}>
      <div className="relative flex flex-col flex-1 h-full min-h-0">
        <Workspace />
        {syncTooltip && (
          <HeaderActionTooltip
            x={syncTooltip.x}
            y={syncTooltip.y}
            title={syncTooltipTitle}
            lines={syncTooltipLines}
          />
        )}
        {pushTooltip && (
          <HeaderActionTooltip
            x={pushTooltip.x}
            y={pushTooltip.y}
            title={pushTooltipTitle}
            lines={pushTooltipLines}
          />
        )}
        <ActionToast
          toast={feedback}
          title={feedback?.type === 'success' ? 'Git Updated' : 'Git Action Failed'}
          onDismiss={() => setFeedback(null)}
        />
        <Modal
          open={showPushConfirm}
          onClose={() => {
            if (pushDefaultBranchMutation.isPending) return;
            pushDefaultBranchMutation.reset();
            setShowPushConfirm(false);
          }}
          title={`Push ${project.defaultBranch || 'main'} to origin?`}
          size="sm"
          footer={(
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  pushDefaultBranchMutation.reset();
                  setShowPushConfirm(false);
                }}
                disabled={pushDefaultBranchMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => pushDefaultBranchMutation.mutate()}
                loading={pushDefaultBranchMutation.isPending}
                disabled={pushDefaultBranchMutation.isPending}
              >
                Push
              </Button>
            </div>
          )}
        >
          <div className="px-5 py-3 space-y-2">
            <p className="text-sm text-dim">
              This pushes <span className="font-mono text-[var(--color-text-primary)]">{project.defaultBranch || 'main'}</span> from your local repository to <span className="font-mono text-[var(--color-text-primary)]">origin/{project.defaultBranch || 'main'}</span>.
            </p>
            {pushDefaultBranchMutation.isError && (
              <p className="text-xs text-[var(--color-error)]">
                {pushDefaultBranchMutation.error instanceof Error ? pushDefaultBranchMutation.error.message : 'Failed to push branch'}
              </p>
            )}
          </div>
        </Modal>
      </div>
    </WorkspaceProvider>
  );
}

function HeaderActionTooltip({ x, y, title, lines }: { x: number; y: number; title: string; lines: string[] }) {
  const [pos, setPos] = useState({ x, y });
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y + 30; // default: below hovered button
    if (nx + rect.width > window.innerWidth - 12) {
      nx = x - rect.width - 16;
    }
    if (nx < 12) nx = 12;
    if (ny + rect.height > window.innerHeight - 12) {
      ny = y - rect.height - 10; // fallback: above button
    }
    if (ny < 12) ny = 12;
    const timer = window.setTimeout(() => setPos({ x: nx, y: ny }), 0);
    return () => window.clearTimeout(timer);
  }, [el, x, y]);

  return createPortal(
    <div
      ref={setEl}
      className="fixed z-[200] bg-elevated border border-subtle rounded-lg shadow-lg w-80 text-xs animate-fadeIn pointer-events-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="px-3 pt-2.5 pb-2 border-b border-subtle/50">
        <div className="font-medium text-[13px] text-[var(--color-text-primary)] leading-snug">{title}</div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {lines.map((line) => (
          <div key={line} className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
            {line}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
