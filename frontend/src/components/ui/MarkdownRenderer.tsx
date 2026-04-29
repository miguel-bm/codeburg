import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokenizeCodeburgReferences, type CodeburgReference } from '../chat/referenceTokens';

interface MarkdownRendererProps {
  children: string;
  className?: string;
  conversationId?: string;
  skillManagerHref?: string;
  enhanceCodeburgRefs?: boolean;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
}

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

type HighlightKind = 'comment' | 'string' | 'number' | 'keyword' | 'function' | 'property' | 'tag' | 'variable';

interface HighlightPattern {
  kind: HighlightKind;
  regex: RegExp;
}

const FILE_REF_PREFIX = '#codeburg-file:';
const SKILL_REF_PREFIX = '#codeburg-skill:';

const HIGHLIGHT_CLASSES: Record<HighlightKind, string> = {
  comment: 'text-dim italic',
  string: 'text-[var(--color-success)]',
  number: 'text-[var(--color-warning)]',
  keyword: 'text-accent',
  function: 'font-medium text-[var(--color-text-primary)]',
  property: 'text-[var(--color-text-secondary)]',
  tag: 'text-accent',
  variable: 'text-[var(--color-warning)]',
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: 'javascript',
  htm: 'html',
  js: 'javascript',
  jsx: 'jsx',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  postgres: 'sql',
  postgresql: 'sql',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  ts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  zsh: 'shell',
};

export function MarkdownRenderer({ children, className = '', skillManagerHref, enhanceCodeburgRefs = false, onOpenWorkspaceFile }: MarkdownRendererProps) {
  const components = useMemo(
    () => markdownComponents({ skillManagerHref, onOpenWorkspaceFile }),
    [skillManagerHref, onOpenWorkspaceFile],
  );

  return (
    <div className={`prose-md ${className}`}>
      <Markdown
        remarkPlugins={enhanceCodeburgRefs ? [remarkGfm, remarkCodeburgInlineRefs] : [remarkGfm]}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}

function markdownComponents({
  skillManagerHref,
  onOpenWorkspaceFile,
}: {
  skillManagerHref?: string;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
}): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    code: ({ children, className }) => {
      const raw = String(children ?? '');
      const language = languageFromClassName(className);
      if (!language && !raw.includes('\n')) {
        return (
          <code className="rounded-md bg-secondary px-1 py-0.5 font-mono text-[0.92em] text-[var(--color-text-primary)]">
            {children}
          </code>
        );
      }
      return <CodeBlock code={raw.replace(/\n$/, '')} language={language} />;
    },
    a: ({ children, href }) => {
      if (href?.startsWith(SKILL_REF_PREFIX)) {
        const skillName = decodeURIComponent(href.slice(SKILL_REF_PREFIX.length));
        return (
          <SkillReferenceTag skillName={skillName} skillManagerHref={skillManagerHref}>
            {children}
          </SkillReferenceTag>
        );
      }
      if (href?.startsWith(FILE_REF_PREFIX)) {
        const reference = decodeWorkspaceFileHref(href);
        const className = "mx-0.5 inline-flex max-w-full align-middle rounded-md bg-[var(--color-warning)]/12 px-1.5 py-0.5 font-mono text-[0.92em] font-medium text-[var(--color-warning)] no-underline transition-colors hover:bg-[var(--color-warning)]/18 hover:text-[var(--color-warning)]";
        if (onOpenWorkspaceFile && reference.path) {
          return (
            <button
              type="button"
              className={className}
              title={reference.isDirectory ? `Reveal ${reference.path} in Files` : `Open ${reference.line ? `${reference.path}:${reference.line}` : reference.path}`}
              onClick={(event) => {
                event.preventDefault();
                onOpenWorkspaceFile(reference.path, reference.line, reference.isDirectory);
              }}
            >
              {children}
            </button>
          );
        }
        return (
          <span className={className} title={reference.path}>
            {children}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const normalizedLanguage = normalizeLanguage(language);
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(
    () => highlightCode(code, normalizedLanguage),
    [code, normalizedLanguage],
  );
  const copyCode = async () => {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="codeburg-code-block not-prose group relative my-3 overflow-hidden rounded-lg">
      {normalizedLanguage && (
        <div className="px-5 pb-0 pt-2.5 pr-10 font-mono text-[10px] font-medium text-dim opacity-75">
          {normalizedLanguage}
        </div>
      )}
      <button
        type="button"
        onClick={() => void copyCode()}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-dim opacity-60 transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        title="Copy code"
        aria-label="Copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre className={`m-0 max-h-[32rem] overflow-auto px-5 pr-10 ${normalizedLanguage ? 'pb-4 pt-2' : 'py-4'} text-[12px] leading-5 text-[var(--color-text-primary)]`}>
        <code className="font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

function SkillReferenceTag({
  skillName,
  skillManagerHref,
  children,
}: {
  skillName: string;
  skillManagerHref?: string;
  children: ReactNode;
}) {
  const href = skillManagerHref || '/skills';

  return (
    <span className="not-prose relative mx-0.5 inline-flex align-middle">
      <a
        href={href}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[0.92em] font-medium text-accent no-underline transition-colors hover:bg-accent/15 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        title={`Open skills for /skill:${skillName}`}
      >
        {children}
      </a>
    </span>
  );
}

function remarkCodeburgInlineRefs() {
  return (tree: MarkdownNode) => {
    visitMarkdownNode(tree);
  };
}

function visitMarkdownNode(node: MarkdownNode, parentType = '') {
  if (!node.children || node.type === 'code' || node.type === 'inlineCode' || node.type === 'link') return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string' && parentType !== 'link') {
      return tokenizeInlineRefs(child.value);
    }
    visitMarkdownNode(child, node.type ?? '');
    return [child];
  });
}

function tokenizeInlineRefs(value: string): MarkdownNode[] {
  return tokenizeCodeburgReferences(value).map((segment) => {
    if (segment.type === 'text') return { type: 'text', value: segment.value };
    return referenceToMarkdownLink(segment.reference);
  });
}

function referenceToMarkdownLink(reference: CodeburgReference): MarkdownNode {
  if (reference.kind === 'skill') {
    return {
      type: 'link',
      url: `${SKILL_REF_PREFIX}${encodeURIComponent(reference.name)}`,
      title: null,
      children: [{ type: 'text', value: reference.name }],
    };
  }
  return {
    type: 'link',
    url: encodeWorkspaceFileHref(reference),
    title: null,
    children: [{ type: 'text', value: reference.raw }],
  };
}

function encodeWorkspaceFileHref(reference: Extract<CodeburgReference, { kind: 'file' }>): string {
  const params = new URLSearchParams();
  if (reference.line) params.set('line', String(reference.line));
  if (reference.isDirectory) params.set('dir', '1');
  const query = params.toString();
  return `${FILE_REF_PREFIX}${encodeURIComponent(reference.path)}${query ? `?${query}` : ''}`;
}

function decodeWorkspaceFileHref(href: string): { path: string; line?: number; isDirectory?: boolean } {
  const encoded = href.slice(FILE_REF_PREFIX.length);
  const [encodedPath, query = ''] = encoded.split('?', 2);
  const params = new URLSearchParams(query);
  const line = Number.parseInt(params.get('line') ?? '', 10);
  return {
    path: decodeURIComponent(encodedPath ?? ''),
    line: Number.isFinite(line) ? line : undefined,
    isDirectory: params.get('dir') === '1',
  };
}

function languageFromClassName(className?: string): string | undefined {
  const match = /language-([^\s]+)/.exec(className ?? '');
  return normalizeLanguage(match?.[1]);
}

function normalizeLanguage(language?: string): string | undefined {
  const normalized = language?.trim().toLowerCase().replace(/^\./, '');
  if (!normalized) return undefined;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function highlightCode(code: string, language?: string): string {
  const patterns = highlightPatternsForLanguage(language);
  if (patterns.length === 0) return escapeHtml(code);
  return highlightWithPatterns(code, patterns);
}

function highlightWithPatterns(code: string, patterns: HighlightPattern[]): string {
  const tokens: Array<{ start: number; end: number; kind: HighlightKind }> = [];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(code)) !== null) {
      const value = match[0];
      if (!value) {
        pattern.regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + value.length;
      if (!tokens.some((token) => start < token.end && token.start < end)) {
        tokens.push({ start, end, kind: pattern.kind });
      }
    }
  }

  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let html = '';
  for (const token of tokens) {
    html += escapeHtml(code.slice(cursor, token.start));
    html += `<span class="${HIGHLIGHT_CLASSES[token.kind]}">${escapeHtml(code.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }
  html += escapeHtml(code.slice(cursor));
  return html;
}

function highlightPatternsForLanguage(language?: string): HighlightPattern[] {
  switch (language) {
    case 'sql':
      return SQL_PATTERNS;
    case 'json':
      return JSON_PATTERNS;
    case 'yaml':
      return YAML_PATTERNS;
    case 'html':
    case 'xml':
      return HTML_PATTERNS;
    case 'css':
    case 'scss':
      return CSS_PATTERNS;
    case 'shell':
    case 'bash':
      return SHELL_PATTERNS;
    case 'python':
      return PYTHON_PATTERNS;
    case 'go':
      return GO_PATTERNS;
    case 'rust':
      return RUST_PATTERNS;
    case 'java':
      return JAVA_PATTERNS;
    case 'csharp':
    case 'cs':
      return CSHARP_PATTERNS;
    case 'php':
      return PHP_PATTERNS;
    case 'ruby':
      return RUBY_PATTERNS;
    case 'markdown':
      return MARKDOWN_PATTERNS;
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return JS_PATTERNS;
    default:
      return GENERIC_PATTERNS;
  }
}

function keywordPattern(words: string[], flags = 'g'): RegExp {
  return new RegExp(`\\b(?:${words.join('|')})\\b`, flags);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const C_BLOCK_COMMENT: HighlightPattern = { kind: 'comment', regex: /\/\*[\s\S]*?\*\//g };
const C_LINE_COMMENT: HighlightPattern = { kind: 'comment', regex: /\/\/[^\n\r]*/g };
const HASH_COMMENT: HighlightPattern = { kind: 'comment', regex: /#[^\n\r]*/g };
const NUMBER_PATTERN: HighlightPattern = { kind: 'number', regex: /\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi };
const JS_STRING: HighlightPattern = { kind: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g };
const SIMPLE_STRING: HighlightPattern = { kind: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g };
const FUNCTION_PATTERN: HighlightPattern = { kind: 'function', regex: /\b[A-Za-z_$][\w$]*(?=\s*\()/g };

const JS_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  JS_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'yield']) },
  FUNCTION_PATTERN,
];

const SQL_PATTERNS: HighlightPattern[] = [
  { kind: 'comment', regex: /--[^\n\r]*/g },
  C_BLOCK_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['add', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'cast', 'constraint', 'create', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'false', 'from', 'group', 'having', 'in', 'inner', 'insert', 'into', 'is', 'join', 'left', 'limit', 'not', 'null', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right', 'select', 'set', 'table', 'then', 'true', 'union', 'update', 'values', 'when', 'where', 'with'], 'gi') },
  FUNCTION_PATTERN,
];

const JSON_PATTERNS: HighlightPattern[] = [
  { kind: 'property', regex: /"(?:\\.|[^"\\])*"(?=\s*:)/g },
  { kind: 'string', regex: /"(?:\\.|[^"\\])*"/g },
  NUMBER_PATTERN,
  { kind: 'keyword', regex: /\b(?:true|false|null)\b/g },
];

const YAML_PATTERNS: HighlightPattern[] = [
  HASH_COMMENT,
  SIMPLE_STRING,
  { kind: 'property', regex: /\b[A-Za-z0-9_-]+(?=\s*:)/g },
  NUMBER_PATTERN,
  { kind: 'keyword', regex: /\b(?:true|false|null|yes|no|on|off)\b/gi },
];

const HTML_PATTERNS: HighlightPattern[] = [
  { kind: 'comment', regex: /<!--[\s\S]*?-->/g },
  SIMPLE_STRING,
  { kind: 'tag', regex: /<\/?[A-Za-z][\w:-]*/g },
  { kind: 'property', regex: /\s[A-Za-z_:][\w:.-]*(?==)/g },
];

const CSS_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  SIMPLE_STRING,
  { kind: 'property', regex: /[A-Za-z-]+(?=\s*:)/g },
  { kind: 'number', regex: /#[\da-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ms|s)?\b/gi },
  { kind: 'keyword', regex: /@[A-Za-z-]+/g },
  FUNCTION_PATTERN,
];

const SHELL_PATTERNS: HighlightPattern[] = [
  HASH_COMMENT,
  SIMPLE_STRING,
  { kind: 'variable', regex: /\$[A-Za-z_][\w]*|\$\{[^}]+\}/g },
  { kind: 'keyword', regex: keywordPattern(['case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function', 'if', 'in', 'then', 'while']) },
];

const PYTHON_PATTERNS: HighlightPattern[] = [
  HASH_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield']) },
  FUNCTION_PATTERN,
];

const GO_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  JS_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['break', 'case', 'chan', 'const', 'continue', 'defer', 'default', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'nil', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']) },
  FUNCTION_PATTERN,
];

const RUST_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while']) },
  FUNCTION_PATTERN,
];

const JAVA_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['abstract', 'assert', 'boolean', 'break', 'case', 'catch', 'class', 'continue', 'default', 'do', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'for', 'if', 'implements', 'import', 'instanceof', 'interface', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'throws', 'true', 'try', 'void', 'while']) },
  FUNCTION_PATTERN,
];

const CSHARP_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['abstract', 'as', 'async', 'await', 'base', 'bool', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delegate', 'do', 'else', 'enum', 'event', 'false', 'finally', 'for', 'foreach', 'if', 'in', 'interface', 'internal', 'is', 'namespace', 'new', 'null', 'private', 'protected', 'public', 'readonly', 'return', 'sealed', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'using', 'var', 'virtual', 'void', 'while']) },
  FUNCTION_PATTERN,
];

const PHP_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  HASH_COMMENT,
  SIMPLE_STRING,
  { kind: 'variable', regex: /\$[A-Za-z_][\w]*/g },
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['array', 'as', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'echo', 'else', 'elseif', 'extends', 'false', 'final', 'finally', 'foreach', 'function', 'if', 'implements', 'interface', 'namespace', 'new', 'null', 'private', 'protected', 'public', 'return', 'static', 'switch', 'throw', 'trait', 'true', 'try', 'use', 'var', 'while']) },
  FUNCTION_PATTERN,
];

const RUBY_PATTERNS: HighlightPattern[] = [
  HASH_COMMENT,
  SIMPLE_STRING,
  NUMBER_PATTERN,
  { kind: 'keyword', regex: keywordPattern(['alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined', 'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while', 'yield']) },
  FUNCTION_PATTERN,
];

const MARKDOWN_PATTERNS: HighlightPattern[] = [
  { kind: 'keyword', regex: /^#{1,6}\s.+$/gm },
  { kind: 'tag', regex: /\[[^\]]+\]\([^)]+\)/g },
  { kind: 'string', regex: /`[^`]+`/g },
];

const GENERIC_PATTERNS: HighlightPattern[] = [
  C_BLOCK_COMMENT,
  C_LINE_COMMENT,
  HASH_COMMENT,
  JS_STRING,
  NUMBER_PATTERN,
  FUNCTION_PATTERN,
];
