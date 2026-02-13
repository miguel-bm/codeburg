import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleX, Hammer, TerminalSquare, FileCode2, Brain } from 'lucide-react';
import type { ChatToolCall } from '../../api/chat';

interface ToolCallCardProps {
  tool: ChatToolCall;
}

function toolIcon(name: string) {
  if (name === 'CodexBash' || name === 'Bash') return <TerminalSquare size={14} className="text-accent shrink-0" />;
  if (name === 'CodexPatch' || name === 'Edit' || name === 'Write') return <FileCode2 size={14} className="text-accent shrink-0" />;
  if (name === 'CodexReasoning') return <Brain size={14} className="text-accent shrink-0" />;
  return <Hammer size={14} className="text-accent shrink-0" />;
}

function toolStatusIcon(state: ChatToolCall['state']) {
  if (state === 'running') return <CircleDashed size={13} className="text-amber-500 animate-spin shrink-0" />;
  if (state === 'error') return <CircleX size={13} className="text-[var(--color-error)] shrink-0" />;
  return <CircleCheck size={13} className="text-[var(--color-success)] shrink-0" />;
}

function pretty(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(tool.state === 'running' || tool.state === 'error');
  const inputText = useMemo(() => pretty(tool.input), [tool.input]);
  const resultText = useMemo(() => pretty(tool.result), [tool.result]);

  return (
    <article className="rounded-xl border border-subtle bg-card shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-tertiary/60 transition-colors"
      >
        <span className="text-dim">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        {toolIcon(tool.name)}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--color-text-primary)] truncate">
            {tool.title || tool.name}
          </p>
          {tool.description && (
            <p className="text-[11px] text-dim truncate">{tool.description}</p>
          )}
        </div>
        {toolStatusIcon(tool.state)}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-subtle bg-secondary/40">
          {inputText && (
            <section className="pt-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-dim mb-1">Input</p>
              <pre className="text-[11px] text-[var(--color-text-secondary)] bg-primary rounded-md border border-subtle p-2 overflow-auto font-mono">{inputText}</pre>
            </section>
          )}
          {resultText && (
            <section>
              <p className="text-[10px] uppercase tracking-[0.12em] text-dim mb-1">Output</p>
              <pre className={`text-[11px] bg-primary rounded-md border border-subtle p-2 overflow-auto font-mono ${
                tool.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'
              }`}>{resultText}</pre>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

