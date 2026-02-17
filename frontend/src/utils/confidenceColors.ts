/**
 * Calculate confidence color with gradients.
 * 
 * Thresholds:
 * - >= 0.96: Green (gets greener as it increases to 1.0)
 * - 0.93-0.96: Yellow to green gradient
 * - 0.90-0.93: Red to yellow gradient
 * - < 0.90: Red (gets redder as it decreases)
 */

interface ConfidenceColor {
  backgroundColor: string;
  color?: string; // Text color for contrast
}

/**
 * Interpolate between two RGB colors
 */
function interpolateColor(
  color1: [number, number, number],
  color2: [number, number, number],
  factor: number
): [number, number, number] {
  return [
    Math.round(color1[0] + (color2[0] - color1[0]) * factor),
    Math.round(color1[1] + (color2[1] - color1[1]) * factor),
    Math.round(color1[2] + (color2[2] - color1[2]) * factor),
  ];
}

/**
 * Convert RGB array to CSS color string
 */
function rgbToString(rgb: [number, number, number], alpha?: number): string {
  if (alpha !== undefined) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Get confidence color with gradient
 */
export function getConfidenceColor(
  confidence: number | null | undefined,
  opacity: number = 1.0
): ConfidenceColor {
  if (confidence === null || confidence === undefined) {
    return { backgroundColor: 'transparent' };
  }

  // Clamp confidence to [0, 1]
  const conf = Math.max(0, Math.min(1, confidence));

  // Color definitions (RGB)
  const red: [number, number, number] = [248, 215, 218]; // #f8d7da (light red)
  const darkRed: [number, number, number] = [220, 53, 69]; // #dc3545 (darker red)
  const yellow: [number, number, number] = [255, 243, 205]; // #fff3cd (light yellow)
  const green: [number, number, number] = [212, 237, 218]; // #d4edda (light green)
  const darkGreen: [number, number, number] = [40, 167, 69]; // #28a745 (darker green)

  let backgroundColor: string;
  let textColor: string = '#000000'; // Default text color

  if (conf >= 0.96) {
    // Green range: 0.96-1.0, gets greener as it increases
    const factor = (conf - 0.96) / 0.04; // 0 at 0.96, 1 at 1.0
    const rgb = interpolateColor(green, darkGreen, factor);
    backgroundColor = rgbToString(rgb, opacity);
    textColor = '#155724'; // Dark green text
  } else if (conf >= 0.93) {
    // Yellow to green gradient: 0.93-0.96
    const factor = (conf - 0.93) / 0.03; // 0 at 0.93, 1 at 0.96
    const rgb = interpolateColor(yellow, green, factor);
    backgroundColor = rgbToString(rgb, opacity);
    textColor = '#856404'; // Dark yellow/green text
  } else if (conf >= 0.90) {
    // Red to yellow gradient: 0.90-0.93
    const factor = (conf - 0.90) / 0.03; // 0 at 0.90, 1 at 0.93
    const rgb = interpolateColor(red, yellow, factor);
    backgroundColor = rgbToString(rgb, opacity);
    textColor = '#721c24'; // Dark red/yellow text
  } else {
    // Red range: < 0.90, gets redder as it decreases
    const factor = Math.min(1, (0.90 - conf) / 0.10); // 0 at 0.90, 1 at 0.80
    const rgb = interpolateColor(red, darkRed, factor);
    backgroundColor = rgbToString(rgb, opacity);
    textColor = '#721c24'; // Dark red text
  }

  return { backgroundColor, color: textColor };
}

/**
 * Get confidence style object for React inline styles
 */
export function getConfidenceStyle(
  confidence: number | null | undefined,
  opacity: number = 1.0
): React.CSSProperties {
  const { backgroundColor, color } = getConfidenceColor(confidence, opacity);
  return {
    backgroundColor,
    color,
  };
}

/**
 * Get Tailwind-compatible class name (for backward compatibility)
 * Note: This doesn't support gradients, use getConfidenceStyle for gradients
 */
export function getConfidenceClass(
  confidence: number | null | undefined
): string {
  if (confidence === null || confidence === undefined) return '';
  if (confidence >= 0.96) return 'confidence-high';
  if (confidence >= 0.93) return 'confidence-medium-high';
  if (confidence >= 0.90) return 'confidence-medium-low';
  return 'confidence-low';
}
