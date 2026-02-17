import { describe, it, expect } from 'vitest';
import { formatFilenameForDisplay } from '../filename';

describe('formatFilenameForDisplay', () => {
  describe('without stripFromLastDash (default)', () => {
    it('strips extension and returns full base as label when short', () => {
      const r = formatFilenameForDisplay('path/doc.png', 99);
      expect(r?.full).toBe('doc.png');
      expect(r?.label).toBe('doc');
    });

    it('truncates long names with ellipsis', () => {
      const r = formatFilenameForDisplay('verylongfilename.png', 10);
      expect(r?.full).toBe('verylongfilename.png');
      expect(r?.label).toMatch(/…/);
      expect(r?.label.length).toBeLessThanOrEqual(10 + 2);
    });
  });

  describe('with stripFromLastDash true', () => {
    it('label is part before last dash when base has one dash', () => {
      const r = formatFilenameForDisplay('doc-abc123.png', 99, true);
      expect(r?.full).toBe('doc-abc123.png');
      expect(r?.label).toBe('doc');
    });

    it('label is everything before last dash when base has multiple dashes', () => {
      const r = formatFilenameForDisplay('my-file-xyz.png', 99, true);
      expect(r?.full).toBe('my-file-xyz.png');
      expect(r?.label).toBe('my-file');
    });

    it('label is full base when base has no dash', () => {
      const r = formatFilenameForDisplay('document.png', 99, true);
      expect(r?.full).toBe('document.png');
      expect(r?.label).toBe('document');
    });

    it('extension is still stripped', () => {
      const r = formatFilenameForDisplay('name-id.jpg', 99, true);
      expect(r?.full).toBe('name-id.jpg');
      expect(r?.label).toBe('name');
    });

    it('full always contains full filename for tooltip', () => {
      const r = formatFilenameForDisplay('/a/b/scan-abc123.tiff', 99, true);
      expect(r?.full).toBe('scan-abc123.tiff');
      expect(r?.label).toBe('scan');
    });

    it('returns null for null or empty input', () => {
      expect(formatFilenameForDisplay(null, 18, true)).toBeNull();
      expect(formatFilenameForDisplay('', 18, true)).toBeNull();
    });
  });
});
