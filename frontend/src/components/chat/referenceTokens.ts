export type CodeburgReference =
  | { kind: 'skill'; name: string; raw: string }
  | { kind: 'file'; path: string; line?: number; raw: string; isDirectory?: boolean };

export type CodeburgReferenceSegment =
  | { type: 'text'; value: string }
  | { type: 'reference'; reference: CodeburgReference };

const INLINE_REF_PATTERN = /(^|[\s([{"'`])((\/skill:([A-Za-z0-9][A-Za-z0-9._-]*))|@([A-Za-z0-9._/-][A-Za-z0-9_./:-]*))/g;
const TRAILING_TOKEN_PUNCTUATION = /[.,;!?)]/;

export function tokenizeCodeburgReferences(value: string): CodeburgReferenceSegment[] {
  const segments: CodeburgReferenceSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REF_PATTERN.lastIndex = 0;

  while ((match = INLINE_REF_PATTERN.exec(value)) !== null) {
    const boundary = match[1] ?? '';
    const rawToken = match[2] ?? '';
    const tokenStart = match.index + boundary.length;
    const tokenEnd = tokenStart + rawToken.length;
    if (tokenStart > lastIndex) {
      segments.push({ type: 'text', value: value.slice(lastIndex, tokenStart) });
    }

    const { token, trailing } = trimTokenPunctuation(rawToken);
    const reference = parseCodeburgReferenceToken(token);
    if (reference) {
      segments.push({ type: 'reference', reference });
      if (trailing) segments.push({ type: 'text', value: trailing });
    } else {
      segments.push({ type: 'text', value: rawToken });
    }
    lastIndex = tokenEnd;
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value }];
}

export function parseCodeburgReferences(value: string): CodeburgReference[] {
  return tokenizeCodeburgReferences(value)
    .filter((segment): segment is Extract<CodeburgReferenceSegment, { type: 'reference' }> => segment.type === 'reference')
    .map((segment) => segment.reference);
}

function parseCodeburgReferenceToken(token: string): CodeburgReference | null {
  if (token.startsWith('/skill:')) {
    const name = token.slice('/skill:'.length);
    return name ? { kind: 'skill', name, raw: token } : null;
  }

  if (token.startsWith('@')) {
    const reference = parseWorkspaceFileReference(token.slice(1));
    return reference.path ? { kind: 'file', path: reference.path, line: reference.line, raw: token, isDirectory: reference.isDirectory } : null;
  }

  return null;
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

function parseWorkspaceFileReference(value: string): { path: string; line?: number; isDirectory?: boolean } {
  const isDirectory = value.endsWith('/');
  const normalizedValue = isDirectory ? value.replace(/\/+$/, '') : value;
  const lineMatch = normalizedValue.match(/^(.*):(\d+)$/);
  if (!lineMatch) return { path: normalizedValue, isDirectory };
  const line = Number.parseInt(lineMatch[2], 10);
  return { path: lineMatch[1], line: Number.isFinite(line) ? line : undefined, isDirectory };
}
