import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bolt, FileKey2, Hammer, PlugZap, Save, Trash2, Wrench } from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { ProjectSecretFile } from '../../api/types';
import { Button, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';

interface QuickRunAction {
  id: string;
  name: string;
  command: string;
}

export function V2ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const quickActionKey = useMemo(() => `v2.quick_actions.${id ?? 'unknown'}`, [id]);

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });
  const { data: quickActions = [] } = useQuery({
    queryKey: ['v2-quick-actions', id],
    queryFn: () => preferencesApi.get<QuickRunAction[]>(quickActionKey).catch(() => []),
    enabled: !!id,
  });

  const [setupScript, setSetupScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [secrets, setSecrets] = useState<ProjectSecretFile[]>([]);
  const [secretPath, setSecretPath] = useState('');
  const [secretMode, setSecretMode] = useState<'copy' | 'symlink'>('copy');
  const [secretSource, setSecretSource] = useState('');
  const [actionName, setActionName] = useState('');
  const [actionCommand, setActionCommand] = useState('');
  const safeQuickActions = Array.isArray(quickActions) ? quickActions : [];

  useEffect(() => {
    setSetupScript(project?.setupScript ?? '');
    setTeardownScript(project?.teardownScript ?? '');
    setSecrets(project?.secretFiles ?? []);
  }, [project]);

  const saveLifecycle = useMutation({
    mutationFn: () => projectsApi.update(id!, {
      setupScript: setupScript.trim() || undefined,
      teardownScript: teardownScript.trim() || undefined,
      secretFiles: secrets,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
      ]);
    },
  });

  const saveQuickActions = useMutation({
    mutationFn: (actions: QuickRunAction[]) => preferencesApi.set(quickActionKey, actions),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-quick-actions', id] });
    },
  });

  const addSecret = () => {
    const path = secretPath.trim();
    if (!path) return;
    setSecrets((current) => [...current, {
      path,
      mode: secretMode,
      sourcePath: secretSource.trim() || undefined,
      enabled: true,
    }]);
    setSecretPath('');
    setSecretSource('');
    setSecretMode('copy');
  };

  const addQuickAction = () => {
    const name = actionName.trim();
    const command = actionCommand.trim();
    if (!name || !command) return;
    saveQuickActions.mutate([...safeQuickActions, { id: crypto.randomUUID(), name, command }]);
    setActionName('');
    setActionCommand('');
  };

  return (
    <V2Screen>
      <div className="flex h-12 shrink-0 items-center justify-between bg-canvas px-6">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{project?.name ?? 'Project'} settings</div>
          <div className="text-xs text-dim">Project behavior, workspace bootstrapping, skills, and pi.</div>
        </div>
        <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saveLifecycle.isPending} onClick={() => saveLifecycle.mutate()}>
          Save project
        </Button>
      </div>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-10">
            <SettingsSection icon={<Wrench size={15} />} title="Workspace lifecycle" description="Commands run from the workspace directory during create/delete flows. Keep scripts in the repo and call them here.">
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">Create command</div>
                  <V2Textarea value={setupScript} onChange={(event) => setSetupScript(event.target.value)} className="min-h-44 w-full resize-y font-mono text-xs" placeholder={'pnpm install\ncp .env.example .env'} />
                </label>
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">Delete command</div>
                  <V2Textarea value={teardownScript} onChange={(event) => setTeardownScript(event.target.value)} className="min-h-44 w-full resize-y font-mono text-xs" placeholder="docker compose down --remove-orphans" />
                </label>
              </div>
            </SettingsSection>

            <SettingsSection icon={<FileKey2 size={15} />} title="Secret files" description="Copied or symlinked into worktrees before setup commands run.">
              <div className="space-y-2">
                {secrets.map((secret, index) => (
                  <div key={`${secret.path}-${index}`} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{secret.path}</div>
                      <div className="truncate text-xs text-dim">{secret.sourcePath || 'same relative path'} · {secret.enabled ? 'enabled' : 'disabled'}</div>
                    </div>
                    <div className="text-xs text-dim">{secret.mode}</div>
                    <button type="button" onClick={() => setSecrets((current) => current.filter((_, i) => i !== index))} className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {secrets.length === 0 && <div className="py-3 text-sm text-dim">No secret files configured.</div>}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto]">
                <V2Input value={secretPath} onChange={(event) => setSecretPath(event.target.value)} placeholder=".env" />
                <V2Select value={secretMode} onChange={(event) => setSecretMode(event.target.value as 'copy' | 'symlink')}>
                  <option value="copy">copy</option>
                  <option value="symlink">symlink</option>
                </V2Select>
                <V2Input value={secretSource} onChange={(event) => setSecretSource(event.target.value)} placeholder="Optional source path" />
                <Button size="sm" variant="secondary" icon={<FileKey2 size={14} />} disabled={!secretPath.trim()} onClick={addSecret}>Add</Button>
              </div>
            </SettingsSection>

            <SettingsSection icon={<Bolt size={15} />} title="Quick run actions" description="Configured per project, executed inside the selected workspace through the Run menu.">
              <div className="space-y-2">
                {safeQuickActions.map((action) => (
                  <div key={action.id} className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{action.name}</div>
                      <div className="truncate font-mono text-xs text-dim">{action.command}</div>
                    </div>
                    <button type="button" onClick={() => saveQuickActions.mutate(safeQuickActions.filter((candidate) => candidate.id !== action.id))} className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {safeQuickActions.length === 0 && <div className="py-3 text-sm text-dim">No quick actions yet.</div>}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[14rem_minmax(0,1fr)_auto]">
                <V2Input value={actionName} onChange={(event) => setActionName(event.target.value)} placeholder="Test backend" />
                <V2Input value={actionCommand} onChange={(event) => setActionCommand(event.target.value)} placeholder="GOTOOLCHAIN=auto go test ./internal/api" />
                <Button size="sm" variant="secondary" icon={<Bolt size={14} />} loading={saveQuickActions.isPending} disabled={!actionName.trim() || !actionCommand.trim()} onClick={addQuickAction}>Add action</Button>
              </div>
            </SettingsSection>
          </div>

          <aside className="space-y-6 text-sm">
            <SettingsSection icon={<Hammer size={15} />} title="Skills" description="Project skills live on disk and are managed from the standards-based skills view.">
              <Link to={`/v2/projects/${id}/skills`}>
                <Button size="sm" variant="secondary" icon={<Hammer size={14} />}>Manage skills</Button>
              </Link>
            </SettingsSection>
            <SettingsSection icon={<PlugZap size={15} />} title="Harness" description="Agent runtime updates, login state, and Pi project overrides.">
              <Link to={`/v2/projects/${id}/pi`}>
                <Button size="sm" variant="secondary" icon={<PlugZap size={14} />}>Harness settings</Button>
              </Link>
            </SettingsSection>
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-card-border)] pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 text-dim">{icon}</div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-dim">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
