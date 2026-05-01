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

  const normalizedDraftActions = normalizeActions(draftActions);
  const savedActionCount = normalizeActions(safeActions).filter((action) => action.name && action.command).length;
  const readyActionCount = normalizedDraftActions.filter((action) => action.name && action.command).length;
  const dirty = JSON.stringify(normalizedDraftActions) !== JSON.stringify(normalizeActions(safeActions));

  const saveActions = useMutation({
    mutationFn: () => preferencesApi.set(quickActionKey, normalizedDraftActions.filter((action) => action.name && action.command)),
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
              <div className="mt-1 text-xs text-dim">Compact commands for the workspace Run menu.</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-dim">
            <span className="rounded-full bg-card px-2.5 py-1 shadow-sm">{readyActionCount} ready</span>
            <span className={`rounded-full px-2.5 py-1 shadow-sm ${dirty ? 'bg-accent/10 text-accent' : 'bg-card'}`}>{dirty ? 'Unsaved changes' : `${savedActionCount} saved`}</span>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saveActions.isPending} disabled={!dirty} onClick={() => saveActions.mutate()}>
              Save
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3 px-4 py-4 md:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Bolt size={15} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Run menu commands</h2>
                  <div className="mt-0.5 text-xs text-dim">Name the action, then paste the exact shell command to run in the active workspace.</div>
                </div>
              </div>
            </div>

            <div className="border-y border-subtle bg-[var(--color-inset)]/45 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-dim md:px-5">
              <div className="hidden grid-cols-[2.5rem_minmax(9rem,14rem)_minmax(0,1fr)_2.5rem] gap-3 lg:grid">
                <span />
                <span>Label</span>
                <span>Command</span>
                <span />
              </div>
              <div className="lg:hidden">Commands</div>
            </div>

            <div className="divide-y divide-[var(--color-card-border)]/70">
              {draftActions.map((action, index) => {
                const incomplete = Boolean(action.name.trim() || action.command.trim()) && (!action.name.trim() || !action.command.trim());
                return (
                  <div key={action.id} className="grid gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-card-hover)] md:px-5 lg:grid-cols-[2.5rem_minmax(9rem,14rem)_minmax(0,1fr)_2.5rem] lg:items-center">
                    <div className="flex items-center gap-2 text-xs text-dim lg:block">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary font-medium shadow-sm">{index + 1}</span>
                      <span className="lg:hidden">Run item</span>
                    </div>
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-dim lg:hidden">Label</span>
                      <V2Input
                        value={action.name}
                        onChange={(event) => setDraftActions((current) => current.map((candidate, i) => (
                          i === index ? { ...candidate, name: event.target.value } : candidate
                        )))}
                        placeholder="Test backend"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-dim lg:hidden">Command</span>
                      <V2Input
                        value={action.command}
                        onChange={(event) => setDraftActions((current) => current.map((candidate, i) => (
                          i === index ? { ...candidate, command: event.target.value } : candidate
                        )))}
                        placeholder="GOTOOLCHAIN=auto go test ./internal/api"
                        className="font-mono text-xs"
                      />
                      {incomplete && <span className="mt-1 block text-xs text-[var(--color-warning)]">Add both a label and command to save this action.</span>}
                    </label>
                    <button
                      type="button"
                      onClick={() => setDraftActions((current) => current.filter((_, i) => i !== index))}
                      className="inline-flex h-9 w-9 items-center justify-center justify-self-start rounded-md text-dim transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] lg:justify-self-end"
                      title="Remove action"
                      aria-label="Remove action"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}

              {draftActions.length === 0 && (
                <div className="px-4 py-12 text-center md:px-5">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Bolt size={18} />
                  </div>
                  <div className="mt-3 text-sm font-medium">No run commands yet</div>
                  <div className="mx-auto mt-1 max-w-sm text-xs leading-5 text-dim">Add the recipes you reach for most, like tests, dev servers, or deploy checks.</div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-subtle bg-[var(--color-inset)]/35 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <button
                type="button"
                onClick={addAction}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-card-border)] bg-primary px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-accent"
              >
                <Plus size={15} />
                Add run command
              </button>
              <div className="text-xs text-dim">
                {saveActions.error instanceof Error ? (
                  <span className="text-[var(--color-error)]">{saveActions.error.message}</span>
                ) : dirty ? 'Review and save when the menu looks right.' : 'Run menu is up to date.'}
              </div>
            </div>
          </section>

          <aside className="rounded-xl bg-card p-4 shadow-[var(--shadow-card)] lg:sticky lg:top-4 lg:self-start">
            <div className="text-sm font-semibold">Command tips</div>
            <div className="mt-3 space-y-3 text-xs leading-5 text-dim">
              <p>Commands run from the selected workspace, so relative paths and project-local tools work as expected.</p>
              <p>Keep labels short. The Run menu shows the label first and keeps the command visible underneath for confidence.</p>
              <p>Blank or incomplete rows are ignored when saving.</p>
            </div>
          </aside>
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
