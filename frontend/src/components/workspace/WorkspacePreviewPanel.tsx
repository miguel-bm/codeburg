import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Clipboard, ExternalLink, Globe2, Plus, Radar, SendHorizontal, Square, X } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { useWorkspaceTunnels } from '../../hooks/useWorkspaceTunnels';
import type { PortSuggestion } from '../../api/ports';
import type { TunnelInfo } from '../../api/tunnels';

export function WorkspacePreviewPanel() {
  const { conversationDraft } = useWorkspace();
  const {
    tunnels,
    suggestions,
    suggestionsLoading,
    createTunnel,
    isCreating,
    createError,
    stopTunnel,
    isStopping,
    scanPorts,
    isScanning,
    scanError,
    enabled,
  } = useWorkspaceTunnels();
  const [port, setPort] = useState('');
  const [showManualPort, setShowManualPort] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activePorts = useMemo(() => new Set(tunnels.map((tunnel) => tunnel.port)), [tunnels]);
  const availableSuggestions = suggestions.filter((suggestion) => !activePorts.has(suggestion.port));
  const canInsert = conversationDraft?.enabled === true && typeof conversationDraft.insertText === 'function';

  const copyUrl = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1400);
  };

  const sharePort = async (targetPort: number) => {
    if (!targetPort || targetPort < 1 || targetPort > 65535) return;
    await createTunnel(targetPort);
    setPort('');
    setShowManualPort(false);
  };

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sharePort(Number.parseInt(port, 10));
  };

  if (!enabled) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-5 text-center text-sm text-dim">
        Preview sharing is available from an active V2 workspace.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-primary)]">
              <Globe2 size={15} className="text-accent" />
              Previews
            </div>
            <div className="mt-1 flex max-w-[34rem] items-start gap-1.5 text-[11px] leading-5 text-dim">
              <AlertTriangle size={12} className="mt-1 shrink-0 text-[var(--color-warning)]" />
              <span>Cloudflare quick tunnels are public to anyone with the link until stopped.</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void scanPorts()}
            disabled={isScanning}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:cursor-wait disabled:opacity-60"
          >
            <Radar size={13} className={isScanning ? 'animate-spin' : undefined} />
            {isScanning ? 'Scanning' : 'Scan'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Active Shares</div>
              <button
                type="button"
                onClick={() => setShowManualPort((current) => !current)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-accent transition-colors hover:bg-accent/10"
              >
                {showManualPort ? <X size={13} /> : <Plus size={13} />}
                {showManualPort ? 'Cancel' : 'Port'}
              </button>
            </div>

            {showManualPort && (
              <form onSubmit={handleManualSubmit} className="mb-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="5173"
                  autoFocus
                  className="h-8 w-24 rounded-md border border-subtle bg-primary px-2 font-mono text-xs outline-none transition-colors focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={isCreating || !port}
                  className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
                >
                  Share
                </button>
              </form>
            )}

            {tunnels.length === 0 && !showManualPort ? (
              <EmptyPreviewState onScan={() => void scanPorts()} scanning={isScanning} />
            ) : (
              <div className="space-y-1">
                {tunnels.map((tunnel) => (
                  <TunnelRow
                    key={tunnel.id}
                    tunnel={tunnel}
                    copied={copiedId === tunnel.id}
                    canInsert={canInsert}
                    stopping={isStopping}
                    onCopy={() => void copyUrl(tunnel.id, tunnel.url)}
                    onInsert={() => conversationDraft?.insertText?.(tunnel.url)}
                    onStop={() => void stopTunnel(tunnel.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Detected Ports</div>
            {suggestionsLoading ? (
              <div className="space-y-1">
                <PreviewSkeleton />
                <PreviewSkeleton />
              </div>
            ) : availableSuggestions.length > 0 ? (
              <div className="space-y-1">
                {availableSuggestions.map((suggestion) => (
                  <PortSuggestionRow
                    key={suggestion.port}
                    suggestion={suggestion}
                    creating={isCreating}
                    stopping={isStopping}
                    onShare={() => void sharePort(suggestion.port)}
                    onStopExisting={(id) => void stopTunnel(id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-secondary/55 px-3 py-3 text-xs leading-5 text-dim">
                No detected ports yet. Run a dev server in a workspace terminal, or scan for listeners.
              </div>
            )}
          </section>

          {(createError || scanError) && (
            <div className="rounded-md bg-[var(--color-error)]/8 px-3 py-2 text-xs leading-5 text-[var(--color-error)]">
              {(createError || scanError)?.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyPreviewState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="rounded-md bg-secondary/55 px-3 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-dim">
          <Globe2 size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[var(--color-text-primary)]">No active public shares</div>
          <div className="mt-1 text-xs leading-5 text-dim">Start a dev server, then scan or share its port directly.</div>
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-accent transition-colors hover:bg-accent/10 disabled:cursor-wait disabled:opacity-60"
          >
            <Radar size={13} className={scanning ? 'animate-spin' : undefined} />
            Scan ports
          </button>
        </div>
      </div>
    </div>
  );
}

function TunnelRow({
  tunnel,
  copied,
  canInsert,
  stopping,
  onCopy,
  onInsert,
  onStop,
}: {
  tunnel: TunnelInfo;
  copied: boolean;
  canInsert: boolean;
  stopping: boolean;
  onCopy: () => void;
  onInsert: () => void;
  onStop: () => void;
}) {
  return (
    <div className="group flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary">
      <div className="w-14 shrink-0 font-mono text-xs text-accent">:{tunnel.port}</div>
      <a
        href={tunnel.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-accent"
      >
        {tunnel.url.replace(/^https?:\/\//, '')}
      </a>
      <PreviewIconButton label="Open" asLink href={tunnel.url}>
        <ExternalLink size={13} />
      </PreviewIconButton>
      <PreviewIconButton label={copied ? 'Copied' : 'Copy'} onClick={onCopy}>
        <Clipboard size={13} />
      </PreviewIconButton>
      {canInsert && (
        <PreviewIconButton label="Insert in chat" onClick={onInsert}>
          <SendHorizontal size={13} />
        </PreviewIconButton>
      )}
      <PreviewIconButton label="Stop" onClick={onStop} disabled={stopping} danger>
        <Square size={13} />
      </PreviewIconButton>
    </div>
  );
}

function PortSuggestionRow({
  suggestion,
  creating,
  stopping,
  onShare,
  onStopExisting,
}: {
  suggestion: PortSuggestion;
  creating: boolean;
  stopping: boolean;
  onShare: () => void;
  onStopExisting: (id: string) => void;
}) {
  const conflict = suggestion.status === 'already_tunneled_other_workspace' && suggestion.existingTunnel;
  const alreadyShared = suggestion.status === 'already_tunneled_this_workspace';

  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary">
      <div className="w-14 shrink-0 font-mono text-xs text-accent">:{suggestion.port}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-[var(--color-text-primary)]">
          {conflict ? `Shared by ${suggestion.existingTunnel?.workspaceName || 'another workspace'}` : alreadyShared ? 'Already shared here' : 'Available'}
        </div>
        <div className="truncate text-[11px] text-dim">{suggestion.sources.join(' + ')}</div>
      </div>
      {conflict ? (
        <button
          type="button"
          onClick={() => onStopExisting(suggestion.existingTunnel!.id)}
          disabled={stopping}
          className="inline-flex h-7 items-center rounded-md px-2 text-xs text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/10 disabled:opacity-50"
        >
          Stop theirs
        </button>
      ) : alreadyShared ? null : (
        <button
          type="button"
          onClick={onShare}
          disabled={creating}
          className="inline-flex h-7 items-center rounded-md px-2 text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
        >
          Share
        </button>
      )}
    </div>
  );
}

function PreviewIconButton({
  label,
  children,
  onClick,
  asLink,
  href,
  disabled,
  danger,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  asLink?: boolean;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const className = `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-dim opacity-100 transition-colors hover:bg-primary md:opacity-0 md:group-hover:opacity-100 ${
    danger ? 'hover:text-[var(--color-error)]' : 'hover:text-[var(--color-text-primary)]'
  } disabled:opacity-40`;

  if (asLink && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={label} aria-label={label}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className} title={label} aria-label={label}>
      {children}
    </button>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex h-10 items-center gap-2 rounded-md px-2 py-1.5">
      <div className="h-3 w-12 rounded bg-secondary" />
      <div className="h-3 flex-1 rounded bg-secondary" />
      <div className="h-3 w-12 rounded bg-secondary" />
    </div>
  );
}
