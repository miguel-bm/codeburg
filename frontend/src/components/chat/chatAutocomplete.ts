export interface InputSelection {
  start: number;
  end: number;
}

export interface ActiveToken {
  prefix: string;
  token: string;
  query: string;
  start: number;
  end: number;
}

const STOP_CHARS = new Set(['\n', '\t', ',', '(', ')', '[', ']', '{', '}', '<', '>', ';', '!', '?']);

function isBoundaryChar(char: string): boolean {
  return char === '' || char === ' ' || char === '\n' || STOP_CHARS.has(char);
}

export function findActiveToken(text: string, selection: InputSelection, prefixes: string[] = ['@', '/']): ActiveToken | null {
  if (selection.start !== selection.end) return null;
  if (selection.start < 0 || selection.start > text.length) return null;

  let start = selection.start - 1;
  while (start >= 0) {
    const char = text[start];
    if (prefixes.includes(char)) {
      const prevChar = start > 0 ? text[start - 1] : '';
      if (!isBoundaryChar(prevChar)) {
        start -= 1;
        continue;
      }
      break;
    }
    if (isBoundaryChar(char)) {
      return null;
    }
    start -= 1;
  }

  if (start < 0) return null;

  let end = selection.end;
  while (end < text.length) {
    const char = text[end];
    if (isBoundaryChar(char)) break;
    end += 1;
  }

  const token = text.slice(start, selection.end);
  return {
    prefix: text[start],
    token,
    query: token.slice(1),
    start,
    end,
  };
}

export function applySuggestionToText(
  text: string,
  selection: InputSelection,
  suggestion: string,
  prefixes: string[] = ['@', '/'],
  addTrailingSpace = true,
): { text: string; cursor: number } {
  const active = findActiveToken(text, selection, prefixes);
  const insertValue = addTrailingSpace ? `${suggestion} ` : suggestion;

  if (!active) {
    const before = text.slice(0, selection.start);
    const after = text.slice(selection.end);
    return { text: `${before}${insertValue}${after}`, cursor: before.length + insertValue.length };
  }

  const before = text.slice(0, active.start);
  const after = text.slice(active.end);
  const needsSpace = addTrailingSpace && after[0] !== ' ';
  const replacement = needsSpace ? `${suggestion} ` : suggestion;
  return { text: `${before}${replacement}${after}`, cursor: before.length + replacement.length };
}

export function fuzzyScore(candidate: string, query: string): number {
  if (!query) return 0;
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();

  if (c === q) return 3000;
  if (c.startsWith(q)) return 2000 - Math.min(c.length, 500);
  if (c.includes(q)) return 1500 - c.indexOf(q);

  let qi = 0;
  let score = 0;
  for (let i = 0; i < c.length && qi < q.length; i += 1) {
    if (c[i] === q[qi]) {
      score += (i < 32 ? 8 : 2);
      qi += 1;
    }
  }
  if (qi !== q.length) return -1;
  return score;
}
