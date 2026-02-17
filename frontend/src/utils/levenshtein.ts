/**
 * Levenshtein (edit) distance between two strings.
 * Used as the basis for CER (Character Error Rate) in HTR/OCR evaluation.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export interface ComparisonStats {
  distance: number;
  cer: number;
}

/**
 * Compare manual (reference) to model output. Returns edit distance and CER.
 * CER = distance / max(1, manual.length). Returns null when manual is blank.
 */
export function comparisonStats(
  manual: string,
  model: string
): ComparisonStats | null {
  const manualTrimmed = (manual ?? '').trim();
  if (manualTrimmed === '') return null;
  const modelTrimmed = (model ?? '').trim();
  const distance = levenshteinDistance(manualTrimmed, modelTrimmed);
  const cer = distance / Math.max(1, manualTrimmed.length);
  return { distance, cer };
}
