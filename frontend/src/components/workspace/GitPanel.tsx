import { useState, useRef, useEffect } from 'react';
import { useWorkspaceGit } from '../../hooks/useWorkspaceGit';
import { useWorkspaceStore } from '../../stores/workspace';
import type { GitFileStatus } from '../../api/git';

function statusLabel(s: string): string {
  switch (s) {
    case 'M': return 'M';
    case 'A': return 'A';
    case 'D': return 'D';
    case 'R': return 'R';
    case 'C': return 'C';
    default: return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'M': return 'text-yellow-500';
    case 'A': return 'text-green-500';
    case 'D': return 'text-red-500';
    default: return 'text-dim';
  }
}

function FileEntry({
  file,
  section,
  onStage,
  onUnstage,
  onRevert,
  onClick,
}: {
  file: GitFileStatus;
  section: 'staged' | 'unstaged' | 'untracked';
  onStage?: () => void;
  onUnstage?: () => void;
  onRevert?: () => void;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 group hover:bg-tertiary cursor-pointer text-xs" onClick={onClick}>
      <span className={`w-4 text-center text-[10px] font-mono ${statusColor(file.status)}`}>
        {statusLabel(file.status)}
      </span>
      <span className="flex-1 truncate">{file.path}</span>
      {file.additions !== undefined && file.additions > 0 && (
        <span className="text-[10px] text-green-500">+{file.additions}</span>
      )}
      {file.deletions !== undefined && file.deletions > 0 && (
        <span className="text-[10px] text-red-500">-{file.deletions}</span>
      )}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        {section === 'staged' && onUnstage && (
          <button onClick={(e) => { e.stopPropagation(); onUnstage(); }} className="p-0.5 text-dim hover:text-accent" title="Unstage">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M4 6l4 4 4-4" /></svg>
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onStage && (
          <button onClick={(e) => { e.stopPropagation(); onStage(); }} className="p-0.5 text-dim hover:text-accent" title="Stage">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 14V6M4 10l4-4 4 4" /></svg>
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onRevert && (
          <button onClick={(e) => { e.stopPropagation(); onRevert(); }} className="p-0.5 text-dim hover:text-[var(--color-error)]" title="Revert">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l10 10M3 13L13 3" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function GitPanel() {
  const git = useWorkspaceGit();
  const { openDiff } = useWorkspaceStore();
  const [commitMsg, setCommitMsg] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    staged: true,
    unstaged: true,
    untracked: true,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { status, stage, unstage, revert, commit, pull, push, isCommitting, isPulling, isPushing } = git;

  const toggleSection = (key: string) =>
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }));

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    await commit({ message: commitMsg.trim() });
    setCommitMsg('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCommit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [commitMsg]);

  if (!status) {
    return <div className="flex items-center justify-center h-20 text-xs text-dim">Loading git status...</div>;
  }

  const hasChanges = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Commit section */}
      <div className="px-2 py-2 border-b border-subtle space-y-1.5">
        <textarea
          ref={textareaRef}
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={1}
          className="w-full px-2 py-1.5 text-xs bg-primary border border-subtle rounded-md resize-none focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || status.staged.length === 0 || isCommitting}
            className="flex-1 px-2 py-1 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
          >
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>

      {/* Branch + sync */}
      <div className="px-2 py-1.5 border-b border-subtle flex items-center gap-2 text-xs">
        <span className="font-mono text-dim truncate">{status.branch}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <div className="flex items-center gap-1 ml-auto">
            {status.behind > 0 && (
              <button
                onClick={() => pull()}
                disabled={isPulling}
                className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-tertiary text-dim"
              >
                {isPulling ? '...' : `Pull ${status.behind}`}
              </button>
            )}
            {status.ahead > 0 && (
              <button
                onClick={() => push()}
                disabled={isPushing}
                className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-tertiary text-dim"
              >
                {isPushing ? '...' : `Push ${status.ahead}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-auto">
        {!hasChanges && (
          <div className="flex items-center justify-center h-16 text-xs text-dim">No changes</div>
        )}

        {/* Staged */}
        {status.staged.length > 0 && (
          <Section
            title={`Staged (${status.staged.length})`}
            expanded={expandedSections.staged}
            onToggle={() => toggleSection('staged')}
          >
            {status.staged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="staged"
                onUnstage={() => unstage([f.path])}
                onClick={() => openDiff(f.path, true)}
              />
            ))}
          </Section>
        )}

        {/* Unstaged */}
        {status.unstaged.length > 0 && (
          <Section
            title={`Changes (${status.unstaged.length})`}
            expanded={expandedSections.unstaged}
            onToggle={() => toggleSection('unstaged')}
          >
            {status.unstaged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="unstaged"
                onStage={() => stage([f.path])}
                onRevert={() => revert({ tracked: [f.path] })}
                onClick={() => openDiff(f.path, false)}
              />
            ))}
          </Section>
        )}

        {/* Untracked */}
        {status.untracked.length > 0 && (
          <Section
            title={`Untracked (${status.untracked.length})`}
            expanded={expandedSections.untracked}
            onToggle={() => toggleSection('untracked')}
          >
            {status.untracked.map((path) => (
              <FileEntry
                key={path}
                file={{ path, status: 'A' }}
                section="untracked"
                onStage={() => stage([path])}
                onRevert={() => revert({ untracked: [path] })}
                onClick={() => openDiff(path, false)}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-dim hover:text-[var(--color-text-primary)] bg-secondary"
      >
        <svg viewBox="0 0 16 16" className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor">
          <path d="M6 4l4 4-4 4" />
        </svg>
        {title}
      </button>
      {expanded && children}
    </div>
  );
}
