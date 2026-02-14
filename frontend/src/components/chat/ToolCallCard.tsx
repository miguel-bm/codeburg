import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  FileCode2,
  Hammer,
  TerminalSquare,
  Brain,
} from 'lucide-react';
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

function parseObjectLike(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function prettyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => pretty(item)).join(', ');
  return pretty(value);
}

function compact(value: unknown, max = 160): string {
  const raw = pretty(value).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}...`;
}

function summarizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return compact(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const interestingKeys = ['query', 'command', 'cmd', 'path', 'file', 'url', 'pattern', 'message', 'prompt'];
    for (const key of interestingKeys) {
      if (key in record) {
        const summary = compact(record[key], 120);
        if (summary) return `${key}: ${summary}`;
      }
    }
  }
  return compact(value);
}

function stateMeta(state: ChatToolCall['state']): { label: string; className: string } {
  if (state === 'running') {
    return { label: 'Running', className: 'text-amber-500 border-amber-500/30 bg-amber-500/10' };
  }
  if (state === 'error') {
    return { label: 'Failed', className: 'text-[var(--color-error)] border-[var(--color-error)]/35 bg-[var(--color-error)]/10' };
  }
  return { label: 'Done', className: 'text-[var(--color-success)] border-[var(--color-success)]/35 bg-[var(--color-success)]/10' };
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const inputText = useMemo(() => pretty(tool.input), [tool.input]);
  const resultText = useMemo(() => pretty(tool.result), [tool.result]);
  const inputObject = useMemo(() => parseObjectLike(tool.input), [tool.input]);
  const inputSummary = useMemo(() => summarizeValue(tool.input), [tool.input]);
  const resultSummary = useMemo(() => summarizeValue(tool.result), [tool.result]);
  const status = useMemo(() => stateMeta(tool.state), [tool.state]);

  const copyResult = async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="rounded-lg border border-subtle bg-secondary/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-2.5 py-2 text-left flex items-start gap-2 hover:bg-tertiary/50 transition-colors"
      >
        <span className="mt-0.5 text-dim">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="mt-0.5">{toolIcon(tool.name)}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">
              {tool.title || tool.name}
            </p>
            <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-dim truncate">
            {tool.description || inputSummary || resultSummary || tool.name}
          </p>
        </div>

        <span className="mt-0.5">{toolStatusIcon(tool.state)}</span>
      </button>

      {expanded && (
        <div className="border-t border-subtle bg-primary/45">
          <div className="space-y-2 px-2.5 py-2">
            {inputText && (
              <section className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">Input</p>
                {inputObject ? (
                  <div className="overflow-hidden rounded-md border border-subtle bg-primary">
                    <div className="max-h-40 overflow-auto divide-y divide-subtle">
                      {Object.entries(inputObject).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-[minmax(6.5rem,12rem),1fr] gap-2 px-2 py-1.5 text-[11px]">
                          <div className="font-mono text-dim break-all">{key}</div>
                          <div className="font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">
                            {prettyValue(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-40 overflow-auto rounded-md border border-subtle bg-primary px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap break-words">
                    {inputText}
                  </pre>
                )}
              </section>
            )}

            {resultText && (
              <section className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Output</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyResult();
                    }}
                    className="inline-flex items-center gap-1 rounded border border-subtle bg-secondary px-1.5 py-0.5 text-[10px] text-dim hover:text-[var(--color-text-primary)]"
                    title="Copy output"
                    aria-label="Copy output"
                  >
                    {copied ? <Check size={11} className="text-[var(--color-success)]" /> : <Copy size={11} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className={`max-h-44 overflow-auto rounded-md border border-subtle bg-primary px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap break-words ${
                  tool.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'
                }`}>
                  {resultText}
                </pre>
              </section>
            )}
          </div>

          {!inputText && !resultText && (
            <div className="px-2.5 py-2 text-[11px] text-dim inline-flex items-center gap-1.5">
              <CircleAlert size={12} />
              No structured input/output captured for this tool call.
            </div>
          )}
        </div>
      )}
    </article>
  );
}
