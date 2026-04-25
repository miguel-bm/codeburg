import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bolt, ListPlus, Play, Settings2, Trash2, Wrench } from 'lucide-react';
import { preferencesApi } from '../../api';
import { v2Api } from '../../api/v2';
import { Button, V2Input } from './v2-ui';

export interface QuickRunAction {
  id: string;
  name: string;
  command: string;
}

export function V2QuickActionsMenu({
  projectId,
  workspaceId,
  disabled,
}: {
  projectId?: string;
  workspaceId?: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [actionName, setActionName] = useState('');
  const [actionCommand, setActionCommand] = useState('');
  const quickActionKey = `v2.quick_actions.${projectId ?? 'unknown'}`;

  const { data: actions = [] } = useQuery({
    queryKey: ['v2-quick-actions', projectId],
    queryFn: () => preferencesApi.get<QuickRunAction[]>(quickActionKey).catch(() => []),
    enabled: !!projectId,
  });

  const safeActions = Array.isArray(actions) ? actions : [];

  const saveActions = useMutation({
    mutationFn: (nextActions: QuickRunAction[]) => preferencesApi.set(quickActionKey, nextActions),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-quick-actions', projectId] });
    },
  });

  const runAction = useMutation({
    mutationFn: (action: QuickRunAction) => v2Api.createTerminal(workspaceId!, {
      title: action.name,
      initialCommand: action.command,
    }),
    onSuccess: async (terminal) => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      navigate(`/v2/projects/${projectId}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });

  const addAction = () => {
    const name = actionName.trim();
    const command = actionCommand.trim();
    if (!name || !command) return;
    saveActions.mutate([...safeActions, { id: crypto.randomUUID(), name, command }]);
    setActionName('');
    setActionCommand('');
  };

  return (
    <div className="relative">
      <Button
        size="xs"
        variant="secondary"
        icon={<Play size={13} />}
        disabled={disabled || !projectId || !workspaceId}
        loading={runAction.isPending}
        onClick={() => setOpen((value) => !value)}
      >
        Run
      </Button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-label="Close quick actions" />
          <div className="absolute right-0 top-8 z-50 w-80 rounded-xl bg-card p-2 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bolt size={14} />
                Quick actions
              </div>
              <button type="button" onClick={() => setManaging((value) => !value)} className="rounded-md p-1 text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
                <Settings2 size={14} />
              </button>
            </div>

            <div className="max-h-72 overflow-auto py-1">
              {safeActions.map((action) => (
                <div key={action.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-card-hover)]">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => runAction.mutate(action)}>
                    <div className="truncate text-sm">{action.name}</div>
                    <div className="truncate font-mono text-[11px] text-dim">{action.command}</div>
                  </button>
                  {managing && (
                    <button
                      type="button"
                      className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
                      onClick={() => saveActions.mutate(safeActions.filter((candidate) => candidate.id !== action.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              {safeActions.length === 0 && <div className="px-2 py-4 text-sm text-dim">No actions yet. Add one below.</div>}
            </div>

            <div className="mt-1 space-y-2 rounded-lg bg-inset p-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-dim">
                <ListPlus size={13} />
                Add action
              </div>
              <V2Input value={actionName} onChange={(event) => setActionName(event.target.value)} placeholder="Test backend" className="w-full" />
              <V2Input value={actionCommand} onChange={(event) => setActionCommand(event.target.value)} placeholder="go test ./internal/api" className="w-full font-mono text-xs" />
              <Button size="xs" variant="secondary" icon={<Wrench size={13} />} loading={saveActions.isPending} disabled={!actionName.trim() || !actionCommand.trim()} onClick={addAction}>
                Save action
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
