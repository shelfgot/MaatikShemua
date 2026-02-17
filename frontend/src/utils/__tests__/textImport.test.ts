import { describe, it, expect } from 'vitest';
import { hasPageMarkers, wrapTextForImport } from '../textImport';

describe('text import helpers', () => {
  it('detects Page N markers', () => {
    expect(hasPageMarkers('Page 1\nline')).toBe(true);
    expect(hasPageMarkers('page 2\nx')).toBe(true);
    expect(hasPageMarkers('304b\nx')).toBe(false);
  });

  it('wraps single-page text with target Page N marker', () => {
    expect(wrapTextForImport('line1\nline2', 3)).toBe('Page 3\nline1\nline2');
  });

  it('does not wrap if markers already present', () => {
    expect(wrapTextForImport('Page 2\nx', 3)).toBe('Page 2\nx');
  });
});

