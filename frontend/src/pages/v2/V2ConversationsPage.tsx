import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranchPlus, Search, Sparkles } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation } from '../../api/types';
import { v2Api } from '../../api/v2';

export function V2ConversationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const { data: conversations } = useQuery({
    queryKey: ['v2-conversations', deferredSearch],
    queryFn: () => v2Api.listConversations({ q: deferredSearch, provider: 'pi' }),
  });

  const { data: projects } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });

  const forkConversation = useMutation({
    mutationFn: (conversation: Conversation) =>
      v2Api.forkConversation(conversation.id, {
        title: `${conversation.title} fork`,
        currentWorkspaceId: conversation.currentWorkspaceId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
    },
  });

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );

  return (
    <div className="flex h-full flex-col overflow-auto px-8 py-8 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <section className="overflow-hidden rounded-[2.25rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(249,246,240,0.86))] px-7 py-7 shadow-[0_28px_60px_rgba(30,20,8,0.08)] backdrop-blur-xl">
            <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Durable threads</div>
            <h1 className="mt-4 max-w-3xl text-[2.35rem] font-semibold tracking-[-0.05em] text-neutral-950">
              Search, reopen, and branch project thinking without losing the provider-native history underneath.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-neutral-600">
              Conversations are now the durable planning and execution thread for V2. Search by title or summary, reopen any
              thread, and fork a new branch of work when the original path has already moved on.
            </p>
            <div className="mt-6 flex max-w-xl items-center gap-3 rounded-[1.35rem] bg-white/78 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <Search size={16} className="text-neutral-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title or summary..."
                className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </div>
          </section>

          <section className="rounded-[2rem] bg-[rgba(19,19,18,0.82)] px-6 py-6 text-white shadow-[0_22px_48px_rgba(17,17,17,0.16)]">
            <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Current scope</div>
            <div className="mt-5 space-y-4 text-sm text-white/78">
              <Metric label="Conversations" value={`${conversations?.length ?? 0}`} />
              <Metric label="Provider" value="pi" />
              <Metric label="Search source" value={deferredSearch ? 'Filtered' : 'All threads'} />
            </div>
          </section>
        </div>

        <div className="grid gap-3">
          {(conversations ?? []).map((conversation) => {
            const project = projectById.get(conversation.projectId);
            return (
              <article
                key={conversation.id}
                className="grid gap-4 rounded-[1.65rem] bg-white/76 px-6 py-5 shadow-[0_16px_34px_rgba(30,20,8,0.06)] transition-all hover:bg-white/88"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[1.1rem] font-semibold tracking-[-0.03em] text-neutral-950">{conversation.title}</div>
                    <div className="mt-1 truncate text-sm text-neutral-500">{project?.name ?? conversation.projectId}</div>
                  </div>
                  <div className="rounded-full bg-[#f6f2ea] px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                    {formatRelativeDate(conversation.lastActivityAt)}
                  </div>
                </div>

                {conversation.summary && (
                  <p className="max-w-3xl text-sm leading-6 text-neutral-600">{conversation.summary}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    <span>{conversation.provider}</span>
                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                    <span>{conversation.status}</span>
                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                    <span>{conversation.currentWorkspaceId ? 'workspace attached' : 'project-scoped'}</span>
                    {conversation.parentConversationId && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-neutral-300" />
                        <span>fork</span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => forkConversation.mutate(conversation)}
                      disabled={forkConversation.isPending}
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
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}

          {(conversations?.length ?? 0) === 0 && (
            <div className="rounded-[1.7rem] border border-dashed border-black/10 bg-white/58 px-8 py-12 text-center">
              <Sparkles size={24} className="mx-auto mb-3 text-neutral-400" />
              <div className="text-sm font-medium text-neutral-900">
                {deferredSearch ? 'No conversations match that search yet' : 'No conversations yet'}
              </div>
              <div className="mt-2 text-sm text-neutral-500">
                {deferredSearch
                  ? 'Try a broader search, or create a new conversation from a project screen.'
                  : 'Create the first pi conversation from a project’s conversations screen.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-white/55">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString();
}
