import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bolt, ChevronRight, Play, Settings2 } from 'lucide-react';
import { preferencesApi } from '../../api';
import { v2Api } from '../../api/v2';
import { Button } from './v2-ui';

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
  const quickActionKey = `v2.quick_actions.${projectId ?? 'unknown'}`;

  const { data: actions = [] } = useQuery({
    queryKey: ['v2-quick-actions', projectId],
    queryFn: () => preferencesApi.get<QuickRunAction[]>(quickActionKey).catch(() => []),
    enabled: !!projectId,
  });

  const safeActions = Array.isArray(actions) ? actions : [];

  const runAction = useMutation({
    mutationFn: (action: QuickRunAction) => v2Api.createTerminal(workspaceId!, {
      title: action.name,
      initialCommand: action.command,
    }),
    onSuccess: async (terminal) => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      navigate(`/projects/${projectId}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });

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
          <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 max-h-[min(34rem,calc(100dvh-96px))] overflow-auto rounded-2xl bg-card p-2 shadow-[var(--shadow-card)] ring-1 ring-[var(--color-card-border)] md:absolute md:inset-auto md:right-0 md:top-8 md:w-80 md:max-h-[min(34rem,calc(100vh-5rem))]">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                <Bolt size={14} />
                Run
              </div>
            </div>

            <div className="max-h-72 overflow-auto py-1">
              {safeActions.map((action) => (
                <div key={action.id} className="group flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-card-hover)]">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => runAction.mutate(action)}>
                    <div className="truncate text-sm">{action.name}</div>
                    <div className="truncate font-mono text-[11px] text-dim">{action.command}</div>
                  </button>
                  <ChevronRight size={14} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ))}
              {safeActions.length === 0 && (
                <div className="px-2 py-5 text-sm text-dim">
                  No run commands yet.
                </div>
              )}
            </div>

            {projectId && (
              <Link
                to={`/projects/${projectId}/actions`}
                onClick={() => setOpen(false)}
                className="mt-1 flex min-h-10 items-center justify-between rounded-lg px-2 py-2 text-xs text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]"
              >
                {safeActions.length > 0 ? 'Edit run commands' : 'Configure run commands'}
                <Settings2 size={13} />
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
