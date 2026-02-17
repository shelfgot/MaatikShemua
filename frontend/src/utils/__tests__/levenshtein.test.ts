import { describe, it, expect } from 'vitest';
import { levenshteinDistance, comparisonStats } from '../levenshtein';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns correct distance for single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('returns correct distance for insertion/deletion', () => {
    expect(levenshteinDistance('hello', 'hell')).toBe(1);
    expect(levenshteinDistance('hell', 'hello')).toBe(1);
  });

  it('returns correct distance for multiple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('comparisonStats', () => {
  it('returns null when manual is blank', () => {
    expect(comparisonStats('', 'model')).toBeNull();
    expect(comparisonStats('   ', 'model')).toBeNull();
  });

  it('returns distance and CER when manual is non-blank', () => {
    const r = comparisonStats('hello', 'hello');
    expect(r).toEqual({ distance: 0, cer: 0 });
  });

  it('computes CER as distance / manual length', () => {
    const r = comparisonStats('abcd', 'abxx'); // 2 substitutions -> distance 2
    expect(r?.distance).toBe(2);
    expect(r?.cer).toBe(2 / 4);
  });

  it('uses max(1, manual.length) for CER when manual is single char', () => {
    const r = comparisonStats('a', 'b');
    expect(r?.distance).toBe(1);
    expect(r?.cer).toBe(1);
  });
});
