import { describe, expect, it } from 'vitest';
import { getDiffLayoutMode } from './diffLayout';

describe('getDiffLayoutMode', () => {
  it('uses split mode on roomy desktop diffs', () => {
    expect(getDiffLayoutMode({
      isMobile: false,
      containerWidth: 1400,
      original: 'line one\n',
      modified: 'line one changed\n',
    })).toBe('split');
  });

  it('uses unified mode on tight screens', () => {
    expect(getDiffLayoutMode({
      isMobile: false,
      containerWidth: 700,
      original: 'line one\n',
      modified: 'line one changed\n',
    })).toBe('unified');
  });

  it('uses unified mode on mobile', () => {
    expect(getDiffLayoutMode({
      isMobile: true,
      containerWidth: 1400,
      original: 'line one\n',
      modified: 'line one changed\n',
    })).toBe('unified');
  });

  it('uses unified mode for entirely new files', () => {
    expect(getDiffLayoutMode({
      isMobile: false,
      containerWidth: 1400,
      original: '',
      modified: 'new file content\n',
    })).toBe('unified');
  });
});
