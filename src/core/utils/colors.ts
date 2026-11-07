/**
 * Shared hexadecimal colour parsing and CSS formatting.
 *
 * Settings persist six-digit RGB values for compatibility and append two
 * hexadecimal digits only when an explicit alpha is below 100 percent.
 */

export interface HexColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  hasAlpha: boolean;
}

const FALLBACK_HEX = "#000000";

/** Parse CSS short or full hexadecimal RGB(A) text into byte channels. */
export function parseHexColor(value: string): HexColor | null {
  const text = value.trim().replace(/^#/, "");
  if (![3, 4, 6, 8].includes(text.length) || !/^[\da-f]+$/iu.test(text)) {
    return null;
  }
  const expanded = text.length <= 4 ? text.replace(/./g, (channel) => channel + channel) : text;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    hasAlpha: expanded.length === 8,
  };
}

/** Normalize a colour to the six-digit uppercase value accepted by input[type=color]. */
export function normalizeHexColor(value: string): string {
  const parsed = parseHexColor(value);
  if (!parsed) {
    return FALLBACK_HEX;
  }
  return `#${[parsed.red, parsed.green, parsed.blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

/** Format a picker colour as the persisted RGB or RGBA hexadecimal value. */
export function formatHexColor(value: string, alpha = 1): string {
  const parsed = parseHexColor(value);
  const base = parsed ? normalizeHexColor(value) : FALLBACK_HEX;
  const bounded = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  const alphaByte = Math.round(bounded * 255);
  if (alphaByte >= 255) {
    return base;
  }
  return `${base}${alphaByte.toString(16).padStart(2, "0")}`.toUpperCase();
}

/** Format a colour for a compact readout, omitting the alpha suffix at 100%. */
export function displayHexColor(value: string, includeAlpha = true): string {
  const parsed = parseHexColor(value);
  const base = normalizeHexColor(value);
  if (!includeAlpha || !parsed || parsed.alpha >= 1) {
    return base;
  }
  return `${base} ${Math.round(parsed.alpha * 100)}%`;
}

/** Convert a stored hexadecimal colour into a CSS colour accepted by Canvas. */
export function cssColor(value: string): string {
  const parsed = parseHexColor(value);
  if (!parsed || parsed.alpha >= 1) {
    return normalizeHexColor(value);
  }
  return `rgba(${parsed.red},${parsed.green},${parsed.blue},${parsed.alpha})`;
}
