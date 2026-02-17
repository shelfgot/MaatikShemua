export interface FormattedFilename {
  /** Full original filename including extension (for tooltips/dedup logic) */
  full: string;
  /** Display label without extension, truncated for UI if necessary */
  label: string;
}

/**
 * Extract a filename from a path and format it for display:
 * - strips directories
 * - strips extension
 * - optionally strips from last dash onward (unique id) for label only
 * - truncates long names keeping both start and end when needed
 */
export function formatFilenameForDisplay(
  imagePathOrName: string | null | undefined,
  maxLength: number = 18,
  stripFromLastDash: boolean = false,
): FormattedFilename | null {
  if (!imagePathOrName) return null;

  const raw = imagePathOrName.split('/').pop() ?? imagePathOrName;
  if (!raw) return null;

  const lastDot = raw.lastIndexOf('.');
  const base = lastDot > 0 ? raw.slice(0, lastDot) : raw;

  const labelBase = stripFromLastDash && base.includes('-')
    ? base.slice(0, base.lastIndexOf('-'))
    : base;

  if (labelBase.length <= maxLength) {
    return { full: raw, label: labelBase };
  }

  // Reserve space for start + ellipsis + end
  const ellipsis = '…';
  if (maxLength <= ellipsis.length + 2) {
    return {
      full: raw,
      label: ellipsis + labelBase.slice(-Math.max(1, maxLength - ellipsis.length)),
    };
  }

  const keepStart = Math.ceil((maxLength - ellipsis.length) * 0.6);
  const keepEnd = maxLength - ellipsis.length - keepStart;

  const start = labelBase.slice(0, keepStart);
  const end = labelBase.slice(-keepEnd);

  return {
    full: raw,
    label: `${start}${ellipsis}${end}`,
  };
}

