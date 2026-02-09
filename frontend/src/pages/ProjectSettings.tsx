import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { projectsApi } from '../api';
import type { Project, ProjectWorkflow, BacklogToProgressConfig, ProgressToReviewConfig, ReviewToDoneConfig } from '../api';

export function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 text-dim">Loading...</div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <div className="p-6 text-dim">Project not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="bg-secondary border-b border-subtle px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-dim hover:text-accent transition-colors text-sm"
          >
            &lt; Back
          </button>
          <h2 className="text-sm font-medium">{project.name} / Settings</h2>
        </div>
      </header>
      <div className="p-6 max-w-2xl space-y-8 overflow-y-auto h-[calc(100vh-73px)]">
        <GeneralSection project={project} />
        <WorkflowSection project={project} />
      </div>
    </Layout>
  );
}

function GeneralSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [gitOrigin, setGitOrigin] = useState(project.gitOrigin ?? '');
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(project.name);
    setGitOrigin(project.gitOrigin ?? '');
    setDefaultBranch(project.defaultBranch);
    setDirty(false);
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: () => projectsApi.update(project.id, { name, defaultBranch, gitOrigin: gitOrigin || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDirty(false);
    },
  });

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-4">General</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-dim mb-1">name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-dim mb-1">path</label>
          <div className="px-3 py-2 border border-subtle bg-primary text-dim rounded-md text-sm">{project.path}</div>
        </div>
        <div>
          <label className="block text-xs text-dim mb-1">git remote</label>
          <input
            value={gitOrigin}
            onChange={(e) => { setGitOrigin(e.target.value); setDirty(true); }}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
            placeholder="https://github.com/user/repo.git"
          />
        </div>
        <div>
          <label className="block text-xs text-dim mb-1">default branch</label>
          <input
            value={defaultBranch}
            onChange={(e) => { setDefaultBranch(e.target.value); setDirty(true); }}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
          />
        </div>
        {dirty && (
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </section>
  );
}

function WorkflowSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [workflow, setWorkflow] = useState<ProjectWorkflow>(project.workflow ?? {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setWorkflow(project.workflow ?? {});
    setDirty(false);
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: () => projectsApi.update(project.id, { workflow }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDirty(false);
    },
  });

  const updateBacklogToProgress = (patch: Partial<BacklogToProgressConfig>) => {
    setWorkflow((prev) => ({
      ...prev,
      backlogToProgress: { action: 'nothing' as const, ...prev.backlogToProgress, ...patch },
    }));
    setDirty(true);
  };

  const updateProgressToReview = (patch: Partial<ProgressToReviewConfig>) => {
    setWorkflow((prev) => ({
      ...prev,
      progressToReview: { action: 'nothing' as const, ...prev.progressToReview, ...patch },
    }));
    setDirty(true);
  };

  const updateReviewToDone = (patch: Partial<ReviewToDoneConfig>) => {
    setWorkflow((prev) => ({
      ...prev,
      reviewToDone: { action: 'nothing' as const, ...prev.reviewToDone, ...patch },
    }));
    setDirty(true);
  };

  const b2p = workflow.backlogToProgress;
  const p2r = workflow.progressToReview;
  const r2d = workflow.reviewToDone;

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-4">Workflow Automation</h3>
      <div className="space-y-6">
        {/* Backlog → In Progress */}
        <div className="border border-subtle rounded-lg p-4">
          <h4 className="text-xs text-dim mb-3">BACKLOG → IN_PROGRESS</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-dim mb-1">action</label>
              <select
                value={b2p?.action ?? 'nothing'}
                onChange={(e) => updateBacklogToProgress({ action: e.target.value as BacklogToProgressConfig['action'] })}
                className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
              >
                <option value="nothing">nothing</option>
                <option value="auto_claude">auto-start claude</option>
                <option value="auto_codex">auto-start codex</option>
                <option value="ask">ask which provider</option>
              </select>
            </div>
            {b2p?.action && b2p.action !== 'nothing' && (
              <>
                {(b2p.action === 'auto_claude' || b2p.action === 'auto_codex') && (
                  <div>
                    <label className="block text-xs text-dim mb-1">default model (optional)</label>
                    <input
                      value={b2p.defaultModel ?? ''}
                      onChange={(e) => updateBacklogToProgress({ defaultModel: e.target.value || undefined })}
                      className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
                      placeholder="e.g. claude-sonnet-4-5-20250929"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-dim mb-1">prompt template (optional)</label>
                  <textarea
                    value={b2p.promptTemplate ?? ''}
                    onChange={(e) => updateBacklogToProgress({ promptTemplate: e.target.value || undefined })}
                    rows={3}
                    className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm resize-none"
                    placeholder="Work on: {title}&#10;&#10;{description}"
                  />
                  <p className="text-xs text-dim mt-1">use {'{title}'} and {'{description}'} as placeholders</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* In Progress → In Review */}
        <div className="border border-subtle rounded-lg p-4">
          <h4 className="text-xs text-dim mb-3">IN_PROGRESS → IN_REVIEW</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-dim mb-1">action</label>
              <select
                value={p2r?.action ?? 'nothing'}
                onChange={(e) => updateProgressToReview({ action: e.target.value as ProgressToReviewConfig['action'] })}
                className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
              >
                <option value="nothing">nothing</option>
                <option value="pr_manual">push branch (manual PR)</option>
                <option value="pr_auto">auto-create PR</option>
              </select>
            </div>
            {p2r?.action && p2r.action !== 'nothing' && (
              <div>
                <label className="block text-xs text-dim mb-1">PR base branch</label>
                <input
                  value={p2r.prBaseBranch ?? ''}
                  onChange={(e) => updateProgressToReview({ prBaseBranch: e.target.value || undefined })}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
                  placeholder="main"
                />
              </div>
            )}
          </div>
        </div>

        {/* In Review → Done */}
        <div className="border border-subtle rounded-lg p-4">
          <h4 className="text-xs text-dim mb-3">IN_REVIEW → DONE</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-dim mb-1">action</label>
              <select
                value={r2d?.action ?? 'nothing'}
                onChange={(e) => updateReviewToDone({ action: e.target.value as ReviewToDoneConfig['action'] })}
                className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
              >
                <option value="nothing">nothing</option>
                <option value="merge_branch">merge branch directly</option>
                <option value="merge_pr">merge PR</option>
              </select>
            </div>
            {r2d?.action && r2d.action !== 'nothing' && (
              <>
                <div>
                  <label className="block text-xs text-dim mb-1">merge strategy</label>
                  <select
                    value={r2d.mergeStrategy ?? 'squash'}
                    onChange={(e) => updateReviewToDone({ mergeStrategy: e.target.value as 'merge' | 'squash' | 'rebase' })}
                    className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] text-sm"
                  >
                    <option value="squash">squash</option>
                    <option value="merge">merge</option>
                    <option value="rebase">rebase</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r2d.deleteBranch ?? true}
                    onChange={(e) => updateReviewToDone({ deleteBranch: e.target.checked })}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-dim">delete branch after merge</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r2d.cleanupWorktree ?? true}
                    onChange={(e) => updateReviewToDone({ cleanupWorktree: e.target.checked })}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-dim">cleanup worktree after merge</span>
                </label>
              </>
            )}
          </div>
        </div>

        {dirty && (
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Workflow'}
          </button>
        )}
      </div>
    </section>
  );
}
