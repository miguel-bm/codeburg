import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokenizeCodeburgReferences, type CodeburgReference } from '../chat/referenceTokens';

interface MarkdownRendererProps {
  children: string;
  className?: string;
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

const FILE_REF_PREFIX = '#codeburg-file:';
const SKILL_REF_PREFIX = '#codeburg-skill:';

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
