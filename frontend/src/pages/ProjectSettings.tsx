import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ArrowRight, CheckCircle2, Settings, Zap, SunMoon } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { projectsApi } from '../api';
import type { Project, ProjectWorkflow, BacklogToProgressConfig, ProgressToReviewConfig, ReviewToDoneConfig } from '../api';
import { getResolvedTheme, getThemePreference, setThemePreference, subscribeToThemeChange } from '../lib/theme';
import type { ThemePreference } from '../lib/theme';
import { SectionCard, SectionHeader, SectionBody, FieldRow, FieldLabel, Toggle } from '../components/ui/settings';
import { Select } from '../components/ui/Select';
import type { SelectOption } from '../components/ui/Select';

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
      <div className="flex flex-col h-full">
        <header className="bg-secondary border-b border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/projects/${project.id}`)}
              className="text-dim hover:text-[var(--color-text-primary)] transition-colors text-sm inline-flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <div className="w-px h-4 bg-[var(--color-border)]" />
            <h1 className="text-sm font-semibold tracking-wide">{project.name} / Settings</h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            <GeneralSection project={project} />
            <AppearanceSection />
            <WorkflowSection project={project} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

const THEME_OPTIONS: SelectOption<ThemePreference>[] = [
  { value: 'system', label: 'System', description: 'Follow your OS appearance setting' },
  { value: 'dark', label: 'Dark', description: 'Always use dark mode' },
  { value: 'light', label: 'Light', description: 'Always use light mode' },
];

function AppearanceSection() {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  const resolvedTheme = getResolvedTheme(themePreference);

  useEffect(() => (
    subscribeToThemeChange(({ preference }) => {
      setThemePreferenceState(preference);
    })
  ), []);

  const handleThemeChange = (value: ThemePreference) => {
    setThemePreferenceState(value);
    setThemePreference(value);
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Appearance"
        description="Switch between dark and light themes"
        icon={<SunMoon size={15} />}
      />
      <SectionBody>
        <FieldRow>
          <FieldLabel
            label="Theme"
            description={`Current mode: ${resolvedTheme}`}
          />
          <Select
            value={themePreference}
            onChange={handleThemeChange}
            options={THEME_OPTIONS}
            className="min-w-[210px]"
          />
        </FieldRow>
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Input class ─────────────────────────────────────────────────────── */

const inputClass =
  'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';

/* ─── General Section ─────────────────────────────────────────────────── */

function GeneralSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [gitOrigin, setGitOrigin] = useState(project.gitOrigin ?? '');
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <SectionCard>
      <SectionHeader
        title="General"
        description="Basic project configuration"
        icon={<Settings size={15} />}
      />
      <SectionBody bordered>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-dim mb-1.5">Path</label>
            <div className="px-3 py-2 border border-subtle bg-tertiary text-dim rounded-md text-sm font-mono">
              {project.path}
            </div>
          </div>
        </div>
      </SectionBody>
      <SectionBody bordered>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">Git remote</label>
            <input
              value={gitOrigin}
              onChange={(e) => { setGitOrigin(e.target.value); setDirty(true); }}
              className={inputClass}
              placeholder="https://github.com/user/repo.git"
            />
          </div>
          <div>
            <label className="block text-sm text-dim mb-1.5">Default branch</label>
            <input
              value={defaultBranch}
              onChange={(e) => { setDefaultBranch(e.target.value); setDirty(true); }}
              className={inputClass}
              placeholder="main"
            />
          </div>
        </div>
      </SectionBody>
      <SectionBody>
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Settings saved
          </div>
        )}
        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending || !dirty}
          className="px-5 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Workflow Section ────────────────────────────────────────────────── */

const DEFAULT_PROMPT_TEMPLATE = 'Work on: {title}\n\n{description}';

const B2P_OPTIONS: SelectOption<BacklogToProgressConfig['action']>[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'auto_claude', label: 'Auto-start Claude', description: 'Launch a Claude session when task moves to in-progress' },
  { value: 'auto_codex', label: 'Auto-start Codex', description: 'Launch a Codex session when task moves to in-progress' },
  { value: 'ask', label: 'Ask which provider', description: 'Prompt to choose an agent provider' },
];

const P2R_OPTIONS: SelectOption<ProgressToReviewConfig['action']>[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'pr_manual', label: 'Push branch', description: 'Push the task branch for manual PR creation' },
  { value: 'pr_auto', label: 'Auto-create PR', description: 'Automatically create a pull request' },
];

const R2D_OPTIONS: SelectOption<ReviewToDoneConfig['action']>[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'merge_branch', label: 'Merge branch', description: 'Merge the task branch directly into the base branch' },
  { value: 'merge_pr', label: 'Merge PR', description: 'Merge the associated pull request' },
];

const MERGE_STRATEGY_OPTIONS: SelectOption<'squash' | 'merge' | 'rebase'>[] = [
  { value: 'squash', label: 'Squash', description: 'Squash all commits into one' },
  { value: 'merge', label: 'Merge commit', description: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase', description: 'Rebase onto the base branch' },
];

function TransitionLabel({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium tracking-wide">
      <span className="text-dim">{from}</span>
      <ArrowRight size={12} className="text-dim" />
      <span className="text-[var(--color-text-primary)]">{to}</span>
    </div>
  );
}

function WorkflowSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [workflow, setWorkflow] = useState<ProjectWorkflow>(project.workflow ?? {});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const updateBacklogToProgress = (patch: Partial<BacklogToProgressConfig>) => {
    setWorkflow((prev) => {
      const current = prev.backlogToProgress;
      const merged = { action: 'nothing' as const, ...current, ...patch };
      // Pre-populate prompt template when switching to an agent action
      if (patch.action && patch.action !== 'nothing' && !current?.promptTemplate) {
        merged.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
      }
      return { ...prev, backlogToProgress: merged };
    });
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
    <SectionCard>
      <SectionHeader
        title="Workflow Automation"
        description="Configure automatic actions when tasks change status"
        icon={<Zap size={15} />}
      />

      {/* Backlog → In Progress */}
      <SectionBody bordered>
        <TransitionLabel from="Backlog" to="In Progress" />
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm text-dim mb-1.5">Action</label>
            <Select
              value={b2p?.action ?? 'nothing'}
              onChange={(v) => updateBacklogToProgress({ action: v })}
              options={B2P_OPTIONS}
            />
          </div>
          {b2p?.action && b2p.action !== 'nothing' && (
            <>
              {(b2p.action === 'auto_claude' || b2p.action === 'auto_codex') && (
                <div>
                  <label className="block text-sm text-dim mb-1.5">Default model</label>
                  <input
                    value={b2p.defaultModel ?? ''}
                    onChange={(e) => updateBacklogToProgress({ defaultModel: e.target.value || undefined })}
                    className={inputClass}
                    placeholder="e.g. claude-sonnet-4-5-20250929"
                  />
                  <p className="text-xs text-dim mt-1.5">Leave empty for the provider's default</p>
                </div>
              )}
              <div>
                <label className="block text-sm text-dim mb-1.5">Prompt template</label>
                <textarea
                  value={b2p.promptTemplate ?? ''}
                  onChange={(e) => updateBacklogToProgress({ promptTemplate: e.target.value || undefined })}
                  rows={3}
                  className={`${inputClass} resize-none`}
                  placeholder="Work on: {title}&#10;&#10;{description}"
                />
                <p className="text-xs text-dim mt-1.5">
                  Use {'{title}'} and {'{description}'} as placeholders
                </p>
              </div>
            </>
          )}
        </div>
      </SectionBody>

      {/* In Progress → In Review */}
      <SectionBody bordered>
        <TransitionLabel from="In Progress" to="In Review" />
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm text-dim mb-1.5">Action</label>
            <Select
              value={p2r?.action ?? 'nothing'}
              onChange={(v) => updateProgressToReview({ action: v })}
              options={P2R_OPTIONS}
            />
          </div>
          {p2r?.action && p2r.action !== 'nothing' && (
            <div>
              <label className="block text-sm text-dim mb-1.5">PR base branch</label>
              <input
                value={p2r.prBaseBranch ?? ''}
                onChange={(e) => updateProgressToReview({ prBaseBranch: e.target.value || undefined })}
                className={inputClass}
                placeholder="main"
              />
              <p className="text-xs text-dim mt-1.5">Branch to target for pull requests</p>
            </div>
          )}
        </div>
      </SectionBody>

      {/* In Review → Done */}
      <SectionBody bordered>
        <TransitionLabel from="In Review" to="Done" />
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm text-dim mb-1.5">Action</label>
            <Select
              value={r2d?.action ?? 'nothing'}
              onChange={(v) => updateReviewToDone({ action: v })}
              options={R2D_OPTIONS}
            />
          </div>
          {r2d?.action && r2d.action !== 'nothing' && (
            <>
              <div>
                <label className="block text-sm text-dim mb-1.5">Merge strategy</label>
                <Select
                  value={r2d.mergeStrategy ?? 'squash'}
                  onChange={(v) => updateReviewToDone({ mergeStrategy: v })}
                  options={MERGE_STRATEGY_OPTIONS}
                />
              </div>
              <div className="space-y-0">
                <FieldRow>
                  <FieldLabel label="Delete branch after merge" />
                  <Toggle
                    checked={r2d.deleteBranch ?? true}
                    onChange={(v) => updateReviewToDone({ deleteBranch: v })}
                  />
                </FieldRow>
                <FieldRow>
                  <FieldLabel label="Cleanup worktree after merge" />
                  <Toggle
                    checked={r2d.cleanupWorktree ?? true}
                    onChange={(v) => updateReviewToDone({ cleanupWorktree: v })}
                  />
                </FieldRow>
              </div>
            </>
          )}
        </div>
      </SectionBody>

      {/* Save */}
      <SectionBody>
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Workflow saved
          </div>
        )}
        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending || !dirty}
          className="px-5 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Workflow'}
        </button>
      </SectionBody>
    </SectionCard>
  );
}
