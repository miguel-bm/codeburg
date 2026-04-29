import { describe, expect, it } from 'vitest';
import { findCodeburgReferenceRanges, parseCodeburgReferences } from './referenceTokens';

describe('referenceTokens', () => {
  it('finds skill and file reference ranges', () => {
    const value = 'Use /skill:impeccable on @README.md and @docs/ please.';

    expect(findCodeburgReferenceRanges(value)).toEqual([
      {
        from: 4,
        to: 21,
        reference: { kind: 'skill', name: 'impeccable', raw: '/skill:impeccable' },
      },
      {
        from: 25,
        to: 35,
        reference: { kind: 'file', path: 'README.md', raw: '@README.md', isDirectory: false },
      },
      {
        from: 40,
        to: 46,
        reference: { kind: 'file', path: 'docs', raw: '@docs/', isDirectory: true },
      },
    ]);
  });

  it('keeps trailing punctuation outside the decorated range', () => {
    const value = 'Read @docs/ and @README.md.';

    expect(findCodeburgReferenceRanges(value).map((range) => value.slice(range.from, range.to))).toEqual([
      '@docs/',
      '@README.md',
    ]);
  });

  it('parses line references', () => {
    expect(parseCodeburgReferences('Open @src/main.ts:42')).toEqual([
      { kind: 'file', path: 'src/main.ts', raw: '@src/main.ts:42', line: 42, isDirectory: false },
    ]);
  });
});
