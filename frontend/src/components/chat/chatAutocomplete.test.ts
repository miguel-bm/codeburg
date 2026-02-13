import { describe, expect, it } from 'vitest';
import { applySuggestionToText, findActiveToken, fuzzyScore } from './chatAutocomplete';

describe('findActiveToken', () => {
  it('finds @file token at cursor', () => {
    const text = 'Please inspect @frontend/src/com';
    const selection = { start: text.length, end: text.length };
    expect(findActiveToken(text, selection)).toEqual({
      prefix: '@',
      token: '@frontend/src/com',
      query: 'frontend/src/com',
      start: 15,
      end: text.length,
    });
  });

  it('finds slash token at cursor', () => {
    const text = '/rev';
    const selection = { start: 4, end: 4 };
    expect(findActiveToken(text, selection)?.query).toBe('rev');
    expect(findActiveToken(text, selection)?.prefix).toBe('/');
  });

  it('returns null when cursor is not on prefixed token', () => {
    const text = 'review this';
    const selection = { start: 6, end: 6 };
    expect(findActiveToken(text, selection)).toBeNull();
  });
});

describe('applySuggestionToText', () => {
  it('replaces active token and keeps remaining text', () => {
    const text = 'Check @front and continue';
    const selection = { start: 12, end: 12 };
    const next = applySuggestionToText(text, selection, '@frontend/src/main.tsx');
    expect(next.text).toBe('Check @frontend/src/main.tsx and continue');
  });

  it('can insert without trailing space', () => {
    const text = 'Check @fr';
    const selection = { start: text.length, end: text.length };
    const next = applySuggestionToText(text, selection, '@frontend/', ['@', '/'], false);
    expect(next.text).toBe('Check @frontend/');
  });
});

describe('fuzzyScore', () => {
  it('prioritizes prefix matches over contains', () => {
    const prefix = fuzzyScore('frontend/src/main.tsx', 'front');
    const contains = fuzzyScore('src/frontend/main.tsx', 'front');
    expect(prefix).toBeGreaterThan(contains);
  });

  it('returns -1 for non-matching candidates', () => {
    expect(fuzzyScore('backend/main.go', 'xyz')).toBe(-1);
  });
});
