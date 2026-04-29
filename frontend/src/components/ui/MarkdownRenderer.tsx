import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  children: string;
  className?: string;
  enhanceCodeburgRefs?: boolean;
  onOpenWorkspaceFile?: (path: string, line?: number) => void;
}

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

const FILE_REF_PREFIX = '#codeburg-file:';
const SKILL_REF_PREFIX = '#codeburg-skill:';
const INLINE_REF_PATTERN = /(^|[\s([{"'`])((\/skill:([A-Za-z0-9][A-Za-z0-9._-]*))|@([A-Za-z0-9._/-][A-Za-z0-9_./:-]*))/g;
const TRAILING_TOKEN_PUNCTUATION = /[.,;!?)]/;

export function MarkdownRenderer({ children, className = '', enhanceCodeburgRefs = false, onOpenWorkspaceFile }: MarkdownRendererProps) {
  return (
    <div className={`prose-md ${className}`}>
      <Markdown
        remarkPlugins={enhanceCodeburgRefs ? [remarkGfm, remarkCodeburgInlineRefs] : [remarkGfm]}
        components={{
          a: ({ children, href, ...props }) => {
            if (href?.startsWith(SKILL_REF_PREFIX)) {
              const skillName = decodeURIComponent(href.slice(SKILL_REF_PREFIX.length));
              return (
                <span
                  className="mx-0.5 inline-flex align-middle rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[0.92em] font-medium text-accent"
                  title={`/skill:${skillName}`}
                >
                  {children}
                </span>
              );
            }
            if (href?.startsWith(FILE_REF_PREFIX)) {
              const reference = decodeWorkspaceFileHref(href);
              const className = "mx-0.5 inline-flex max-w-full align-middle rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.92em] font-medium text-[var(--color-text-secondary)] no-underline transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]";
              if (onOpenWorkspaceFile && reference.path) {
                return (
                  <button
                    type="button"
                    className={className}
                    title={`Open ${reference.line ? `${reference.path}:${reference.line}` : reference.path}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenWorkspaceFile(reference.path, reference.line);
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
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </Markdown>
    </div>
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
  const nodes: MarkdownNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REF_PATTERN.lastIndex = 0;

  while ((match = INLINE_REF_PATTERN.exec(value)) !== null) {
    const boundary = match[1] ?? '';
    const rawToken = match[2] ?? '';
    const tokenStart = match.index + boundary.length;
    const tokenEnd = tokenStart + rawToken.length;
    if (tokenStart > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, tokenStart) });
    }

    const { token, trailing } = trimTokenPunctuation(rawToken);
    const node = tokenToMarkdownLink(token);
    if (node) {
      nodes.push(node);
      if (trailing) nodes.push({ type: 'text', value: trailing });
    } else {
      nodes.push({ type: 'text', value: rawToken });
    }
    lastIndex = tokenEnd;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
}

function trimTokenPunctuation(rawToken: string): { token: string; trailing: string } {
  let token = rawToken;
  let trailing = '';
  while (token.length > 0 && TRAILING_TOKEN_PUNCTUATION.test(token[token.length - 1])) {
    trailing = `${token[token.length - 1]}${trailing}`;
    token = token.slice(0, -1);
  }
  return { token, trailing };
}

function tokenToMarkdownLink(token: string): MarkdownNode | null {
  if (token.startsWith('/skill:')) {
    const skillName = token.slice('/skill:'.length);
    if (!skillName) return null;
    return {
      type: 'link',
      url: `${SKILL_REF_PREFIX}${encodeURIComponent(skillName)}`,
      title: null,
      children: [{ type: 'text', value: skillName }],
    };
  }

  if (token.startsWith('@')) {
    const reference = parseWorkspaceFileReference(token.slice(1));
    if (!reference.path) return null;
    return {
      type: 'link',
      url: `${FILE_REF_PREFIX}${encodeURIComponent(reference.path)}${reference.line ? `:${reference.line}` : ''}`,
      title: null,
      children: [{ type: 'text', value: `@${reference.line ? `${reference.path}:${reference.line}` : reference.path}` }],
    };
  }

  return null;
}

function parseWorkspaceFileReference(value: string): { path: string; line?: number } {
  const lineMatch = value.match(/^(.*):(\d+)$/);
  if (!lineMatch) return { path: value };
  const line = Number.parseInt(lineMatch[2], 10);
  return { path: lineMatch[1], line: Number.isFinite(line) ? line : undefined };
}

function decodeWorkspaceFileHref(href: string): { path: string; line?: number } {
  const encoded = href.slice(FILE_REF_PREFIX.length);
  const lineMatch = encoded.match(/^(.*):(\d+)$/);
  const encodedPath = lineMatch ? lineMatch[1] : encoded;
  const line = lineMatch ? Number.parseInt(lineMatch[2], 10) : undefined;
  return {
    path: decodeURIComponent(encodedPath),
    line: Number.isFinite(line) ? line : undefined,
  };
}
