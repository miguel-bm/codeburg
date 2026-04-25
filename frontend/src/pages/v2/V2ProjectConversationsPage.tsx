import type { ReactNode } from 'react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  FolderGit2,
  GitBranchPlus,
  Loader2,
  MessagesSquare,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, PiStatus, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';

export function V2ProjectConversationsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: workspaces } = useQuery({
    queryKey: ['v2-workspaces', id],
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });

  const { data: conversations } = useQuery({
    queryKey: ['v2-project-conversations', id, deferredSearch],
    queryFn: () => v2Api.listProjectConversations(id!, { q: deferredSearch, provider: 'pi' }),
    enabled: !!id,
  });

  const { data: piStatus } = useQuery({
    queryKey: ['pi-status'],
    queryFn: () => v2Api.getPiStatus(),
  });

  const createConversation = useMutation({
    mutationFn: (input: { title: string; currentWorkspaceId?: string }) =>
      v2Api.createConversation(id!, input),
    onSuccess: async () => {
      setTitle('');
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
    },
  });

  const forkConversation = useMutation({
    mutationFn: (conversation: Conversation) =>
      v2Api.forkConversation(conversation.id, {
        title: `${conversation.title} fork`,
        currentWorkspaceId: conversation.currentWorkspaceId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
    },
  });

  const createDefaultTitle = () => {
    if (project?.name) {
      setTitle(`Explore ${project.name}`);
      return;
    }
    setTitle('New pi conversation');
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createConversation.mutate({
      title: trimmed,
      currentWorkspaceId: workspaceId || undefined,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={project ? `/v2/projects/${project.id}` : '/v2'}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ArrowLeft size={15} />
            Back to workspace
          </Link>
          <div className="mt-4 text-[11px] uppercase tracking-[0.28em] text-neutral-500">Project conversations</div>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.05em] text-neutral-950">
            {project?.name ?? 'Project'}
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-7 text-neutral-600">
            Durable pi-native threads for this project. Conversation history remains provider-owned, while Codeburg tracks
            where each thread belongs and which workspace it should work against.
          </p>
        </div>

        <div className="rounded-full border border-black/8 bg-white/75 px-4 py-2 text-sm text-neutral-600 shadow-[0_12px_24px_rgba(31,24,16,0.05)]">
          <div className="flex items-center gap-3">
            <span>{(conversations?.length ?? 0)} conversations</span>
            {project && (
              <Link
                to={`/v2/projects/${project.id}/pi`}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800"
              >
                <Settings2 size={12} />
                Pi settings
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/75 bg-white/60 shadow-[0_30px_60px_rgba(30,20,8,0.08)] backdrop-blur-xl">
        <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1.2fr)_24rem]">
          <section className="flex min-h-0 flex-col border-b border-black/6 lg:border-b-0 lg:border-r">
            <div className="border-b border-black/6 px-6 py-5">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_auto]">
                <label className="min-w-0">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Conversation title</div>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Investigate parser edge cases"
                    className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-black/15"
                  />
                </label>
                <label>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Attach workspace</div>
                  <select
                    value={workspaceId}
                    onChange={(event) => setWorkspaceId(event.target.value)}
                    className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-black/15"
                  >
                    <option value="">Default branch workspace</option>
                    {(workspaces ?? []).map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name} · {workspace.branchName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={createConversation.isPending || !title.trim()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-sm font-medium text-white shadow-[0_16px_28px_rgba(17,17,17,0.16)] disabled:opacity-50"
                  >
                    {createConversation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    New conversation
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
                <button
                  type="button"
                  onClick={createDefaultTitle}
                  className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 transition-colors hover:bg-neutral-50"
                >
                  <Sparkles size={14} />
                  Draft a title
                </button>
                {createConversation.error instanceof Error && (
                  <span className="text-red-600">{createConversation.error.message}</span>
                )}
              </div>

              <div className="mt-4 flex max-w-xl items-center gap-3 rounded-[1.2rem] bg-white/78 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
                <Search size={15} className="text-neutral-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search this project’s conversations..."
                  className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              <div className="space-y-3">
                {(conversations ?? []).map((conversation) => {
                  const currentWorkspace = (workspaces ?? []).find((workspace) => workspace.id === conversation.currentWorkspaceId);
                  return (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      workspace={currentWorkspace}
                      onFork={() => forkConversation.mutate(conversation)}
                      forkPending={forkConversation.isPending}
                    />
                  );
                })}

                {(conversations?.length ?? 0) === 0 && (
                  <div className="rounded-[1.5rem] border border-dashed border-black/10 bg-[#faf8f4] px-8 py-12 text-center">
                    <MessagesSquare size={28} className="mx-auto mb-4 text-neutral-400" />
                    <div className="text-base font-medium text-neutral-950">
                      {deferredSearch ? 'No conversations match that search' : 'No pi conversations yet'}
                    </div>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-500">
                      {deferredSearch
                        ? 'Try a broader query, or fork from an existing thread when a line of work needs to split.'
                        : 'Create a durable conversation for planning, code review, or implementation work. The provider will own the transcript; Codeburg will remember the project and workspace context.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,246,240,0.92),rgba(241,238,231,0.96))]">
            <div className="border-b border-black/6 px-5 py-5">
              <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Pi readiness</div>
              <div className="mt-3 text-lg font-medium tracking-[-0.03em] text-neutral-950">Provider environment</div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              {piStatus && <PiStatusPanel status={piStatus} workspaces={workspaces ?? []} />}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  workspace,
  onFork,
  forkPending,
}: {
  conversation: Conversation;
  workspace?: Workspace;
  onFork: () => void;
  forkPending: boolean;
}) {
  return (
    <article className="rounded-[1.4rem] border border-white/75 bg-white/78 px-5 py-4 shadow-[0_14px_32px_rgba(30,20,8,0.05)] transition-all hover:-translate-y-0.5 hover:bg-white/90">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[1.05rem] font-semibold tracking-[-0.03em] text-neutral-950">{conversation.title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-500">
            <span className="inline-flex items-center gap-2">
              <MessagesSquare size={14} />
              {conversation.provider}
            </span>
            <span>{conversation.status}</span>
            <span>{conversation.preferredSurface}</span>
          </div>
        </div>
        <div className="rounded-full border border-black/8 bg-[#faf8f4] px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          {new Date(conversation.lastActivityAt).toLocaleDateString()}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-neutral-600">
        <div className="inline-flex items-center gap-2">
          <FolderGit2 size={14} />
          <span>{workspace ? `${workspace.name} · ${workspace.branchName}` : 'No workspace attached'}</span>
        </div>
        {conversation.summary && <div className="leading-6 text-neutral-500">{conversation.summary}</div>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          {conversation.parentConversationId ? 'Forked thread' : 'Primary thread'}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onFork}
            disabled={forkPending}
            className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#f6f2ea] px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-[#efe7da] disabled:opacity-50"
          >
            <GitBranchPlus size={15} />
            Fork
          </button>
          <Link
            to={`/v2/conversations/${conversation.id}`}
            className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-[0_16px_28px_rgba(17,17,17,0.14)]"
          >
            Open
          </Link>
        </div>
      </div>
    </article>
  );
}

function PiStatusPanel({
  status,
  workspaces,
}: {
  status: PiStatus;
  workspaces: Workspace[];
}) {
  const mainWorkspace = workspaces.find((workspace) => workspace.kind === 'main') ?? workspaces[0];

  return (
    <div className="space-y-5">
      <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-950">Installation</div>
            <div className="mt-1 text-sm text-neutral-500">pi CLI availability for the runtime user</div>
          </div>
          <StatusPill
            tone={status.installed ? 'good' : 'warn'}
            label={status.installed ? 'Installed' : 'Missing'}
            icon={status.installed ? <CheckCircle2 size={14} /> : <CircleSlash size={14} />}
          />
        </div>
        <div className="mt-4 rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-600">
          <div className="font-medium text-neutral-900">{status.version ?? 'pi not found in PATH'}</div>
          <div className="mt-2 break-all text-xs leading-5 text-neutral-500">{status.agentDir}</div>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-950">Authentication</div>
            <div className="mt-1 text-sm text-neutral-500">Provider-native auth from pi</div>
          </div>
          <StatusPill
            tone={status.authConfigured ? 'good' : 'warn'}
            label={status.authConfigured ? 'Configured' : 'Needs login'}
            icon={status.authConfigured ? <CheckCircle2 size={14} /> : <CircleSlash size={14} />}
          />
        </div>

        {status.authProviders && status.authProviders.length > 0 ? (
          <div className="mt-4 space-y-2">
            {status.authProviders.map((provider) => (
              <div
                key={provider.provider}
                className="flex items-center justify-between rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-700"
              >
                <span>{provider.provider}</span>
                <span className="text-neutral-500">{provider.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <StepList
            steps={[
              `Open a workspace terminal${mainWorkspace ? ` in ${mainWorkspace.name}` : ''}.`,
              'Run `pi`.',
              'Use `/login` to connect a provider or configure an API key.',
              'Use `/model` if you want a specific provider/model after login.',
            ]}
          />
        )}
      </div>

      <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
        <div className="text-sm font-medium text-neutral-950">Custom providers</div>
        <div className="mt-1 text-sm text-neutral-500">Discovered from pi’s models registry</div>
        <div className="mt-4 space-y-2">
          {(status.customProviders ?? []).length > 0 ? (
            status.customProviders?.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-700"
              >
                <span>{provider.id}</span>
                <span className="text-neutral-500">{provider.modelCount} models</span>
              </div>
            ))
          ) : (
            <div className="rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-500">
              No custom providers in models.json yet.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/75 bg-neutral-950 px-4 py-4 text-white shadow-[0_18px_34px_rgba(15,15,15,0.18)]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalSquare size={15} />
          Configure in terminal
        </div>
        <p className="mt-3 text-sm leading-6 text-white/70">
          Codeburg is intentionally reading pi’s native state instead of inventing its own auth model. For now, setup
          still happens through a workspace terminal so pi stays the source of truth.
        </p>
        <div className="mt-4 space-y-2 rounded-2xl bg-white/6 px-4 py-4 font-mono text-xs leading-6 text-white/80">
          <div>pi</div>
          <div>/login</div>
          <div>/model</div>
        </div>
      </div>

      {status.loadWarnings && status.loadWarnings.length > 0 && (
        <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          <div className="font-medium">Warnings</div>
          <ul className="mt-2 space-y-2">
            {status.loadWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: 'good' | 'warn';
  label: string;
  icon: ReactNode;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
        tone === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
      }`}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-4 space-y-3">
      {steps.map((step, index) => (
        <li key={step} className="flex items-start gap-3 rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-600">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-medium text-neutral-700">
            {index + 1}
          </span>
          <span className="leading-6">{step}</span>
        </li>
      ))}
    </ol>
  );
}
