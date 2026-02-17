export function hasPageMarkers(text: string): boolean {
  return /^Page\s+\d+\s*$/im.test(text);
}

export function wrapTextForImport(text: string, targetPageNumber?: number): string {
  if (!targetPageNumber) return text;
  if (hasPageMarkers(text)) return text;
  return `Page ${targetPageNumber}\n${text}`;
}

