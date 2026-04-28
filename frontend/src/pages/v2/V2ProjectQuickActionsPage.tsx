import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bolt, Plus, Save, Trash2 } from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import { Button, V2Input, V2Screen } from './v2-ui';

export interface QuickRunAction {
  id: string;
  name: string;
  command: string;
}

export function V2ProjectQuickActionsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const quickActionKey = useMemo(() => `v2.quick_actions.${id ?? 'unknown'}`, [id]);
  const [draftActions, setDraftActions] = useState<QuickRunAction[]>([]);

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: actions } = useQuery({
    queryKey: ['v2-quick-actions', id],
    queryFn: () => preferencesApi.get<QuickRunAction[]>(quickActionKey).catch(() => []),
    enabled: !!id,
  });

  const safeActions = useMemo(() => Array.isArray(actions) ? actions : [], [actions]);

  useEffect(() => {
    setDraftActions(safeActions);
  }, [safeActions]);

  const dirty = JSON.stringify(normalizeActions(draftActions)) !== JSON.stringify(normalizeActions(safeActions));

  const saveActions = useMutation({
    mutationFn: () => preferencesApi.set(quickActionKey, normalizeActions(draftActions).filter((action) => action.name && action.command)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-quick-actions', id] });
    },
  });

  const addAction = () => {
    setDraftActions((current) => [...current, { id: crypto.randomUUID(), name: '', command: '' }]);
  };

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to={id ? `/projects/${id}/settings` : '/'} className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to project settings">
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Quick actions</div>
              <h1 className="mt-1 truncate text-lg font-semibold">{project?.name ?? 'Project'}</h1>
              <div className="mt-1 text-xs text-dim">Commands shown in the workspace Run menu.</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={addAction}>Add action</Button>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saveActions.isPending} disabled={!dirty} onClick={() => saveActions.mutate()}>
              Save actions
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto max-w-5xl rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-card)] md:px-5">
          <div className="mb-4 flex items-center gap-2.5">
            <Bolt size={15} className="text-dim" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Run menu commands</h2>
              <div className="mt-1 text-xs text-dim">
                {saveActions.error instanceof Error ? (
                  <span className="text-[var(--color-error)]">{saveActions.error.message}</span>
                ) : dirty ? 'Unsaved changes' : 'Saved'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {draftActions.map((action, index) => (
              <div key={action.id} className="grid gap-2 rounded-lg px-3 py-3 transition-colors hover:bg-[var(--color-card-hover)] lg:grid-cols-[14rem_minmax(0,1fr)_auto] lg:items-center">
                <V2Input
                  value={action.name}
                  onChange={(event) => setDraftActions((current) => current.map((candidate, i) => (
                    i === index ? { ...candidate, name: event.target.value } : candidate
                  )))}
                  placeholder="Test backend"
                />
                <V2Input
                  value={action.command}
                  onChange={(event) => setDraftActions((current) => current.map((candidate, i) => (
                    i === index ? { ...candidate, command: event.target.value } : candidate
                  )))}
                  placeholder="GOTOOLCHAIN=auto go test ./internal/api"
                  className="font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setDraftActions((current) => current.filter((_, i) => i !== index))}
                  className="justify-self-start rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] lg:justify-self-auto"
                  title="Remove action"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {draftActions.length === 0 && (
              <div className="rounded-lg bg-[var(--color-inset)]/60 px-3 py-8 text-center text-sm text-dim">
                Add commands you run often in this repo.
              </div>
            )}
          </div>
        </div>
      </main>
    </V2Screen>
  );
}

function normalizeActions(actions: QuickRunAction[]) {
  return actions.map((action) => ({
    id: action.id,
    name: action.name.trim(),
    command: action.command.trim(),
  }));
}
