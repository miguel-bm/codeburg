import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bolt, FileKey2, Save, Settings2, Trash2, Wrench } from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import { SecretsSection } from '../../components/project/SecretsSection';
import { Button, V2Content, V2Input, V2Panel, V2PanelHeader, V2Screen, V2Textarea } from './v2-ui';

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
  const [actionName, setActionName] = useState('');
  const [actionCommand, setActionCommand] = useState('');

  useEffect(() => {
    setSetupScript(project?.setupScript ?? '');
    setTeardownScript(project?.teardownScript ?? '');
  }, [project?.setupScript, project?.teardownScript]);

  const saveLifecycle = useMutation({
    mutationFn: () => projectsApi.update(id!, {
      setupScript: setupScript.trim() || undefined,
      teardownScript: teardownScript.trim() || undefined,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', id] });
      await queryClient.invalidateQueries({ queryKey: ['v2-projects'] });
    },
  });

  const saveQuickActions = useMutation({
    mutationFn: (actions: QuickRunAction[]) => preferencesApi.set(quickActionKey, actions),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-quick-actions', id] });
    },
  });

  const addQuickAction = () => {
    const name = actionName.trim();
    const command = actionCommand.trim();
    if (!name || !command) return;
    saveQuickActions.mutate([
      ...quickActions,
      { id: crypto.randomUUID(), name, command },
    ]);
    setActionName('');
    setActionCommand('');
  };

  const removeQuickAction = (actionId: string) => {
    saveQuickActions.mutate(quickActions.filter((action) => action.id !== actionId));
  };

  return (
    <V2Screen>
      <div className="flex h-10 shrink-0 items-center gap-2 bg-canvas px-5 text-sm">
        <Settings2 size={15} className="text-dim" />
        <span className="font-medium">{project?.name ?? 'Project'} settings</span>
        <span className="text-dim">Workspace lifecycle and run actions</span>
      </div>

      <V2Content className="space-y-4">
        <V2Panel>
          <V2PanelHeader
            title="Workspace lifecycle"
            subtitle="These commands run from Codeburg when creating or deleting non-main workspaces."
            actions={<Button size="sm" variant="primary" icon={<Save size={14} />} loading={saveLifecycle.isPending} onClick={() => saveLifecycle.mutate()}>Save lifecycle</Button>}
          />
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <label className="block">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-dim">
                <Wrench size={13} />
                Create workspace command
              </div>
              <V2Textarea
                value={setupScript}
                onChange={(event) => setSetupScript(event.target.value)}
                className="min-h-44 w-full resize-y font-mono text-xs"
                placeholder={'pnpm install\ncp .env.example .env'}
              />
            </label>
            <label className="block">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-dim">
                <Trash2 size={13} />
                Delete workspace command
              </div>
              <V2Textarea
                value={teardownScript}
                onChange={(event) => setTeardownScript(event.target.value)}
                className="min-h-44 w-full resize-y font-mono text-xs"
                placeholder={'docker compose down --remove-orphans'}
              />
            </label>
          </div>
        </V2Panel>

        {project && (
          <div className="rounded-xl bg-card shadow-[var(--shadow-card)]">
            <div className="px-4 pt-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <FileKey2 size={15} />
                Secret files
              </div>
              <div className="text-xs text-dim">Copied or symlinked into new workspaces before setup commands run.</div>
            </div>
            <SecretsSection project={project} />
          </div>
        )}

        <V2Panel>
          <V2PanelHeader
            title="Quick run actions"
            subtitle="Named project commands shown in the Run menu for project and conversation screens."
          />
          <div className="space-y-3 p-4">
            <div className="grid gap-2 md:grid-cols-[14rem_minmax(0,1fr)_auto]">
              <V2Input value={actionName} onChange={(event) => setActionName(event.target.value)} placeholder="Test backend" />
              <V2Input value={actionCommand} onChange={(event) => setActionCommand(event.target.value)} placeholder="GOTOOLCHAIN=auto go test ./internal/api" />
              <Button size="sm" variant="secondary" icon={<Bolt size={14} />} loading={saveQuickActions.isPending} disabled={!actionName.trim() || !actionCommand.trim()} onClick={addQuickAction}>
                Add action
              </Button>
            </div>
            <div className="space-y-1">
              {quickActions.map((action) => (
                <div key={action.id} className="flex items-center gap-3 rounded-lg bg-inset px-3 py-2">
                  <Bolt size={14} className="text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{action.name}</div>
                    <div className="truncate font-mono text-xs text-dim">{action.command}</div>
                  </div>
                  <Button size="xs" variant="ghost" icon={<Trash2 size={13} />} disabled={saveQuickActions.isPending} onClick={() => removeQuickAction(action.id)}>Remove</Button>
                </div>
              ))}
              {quickActions.length === 0 && <div className="rounded-lg bg-inset px-3 py-3 text-sm text-dim">No quick run actions configured yet.</div>}
            </div>
          </div>
        </V2Panel>
      </V2Content>
    </V2Screen>
  );
}
