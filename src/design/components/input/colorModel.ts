/**
 * Colour value rules shared by the colour swatch and its tests.
 *
 * `normalizeColor` produces the six-digit form the native colour input accepts;
 * `colorInk` chooses the black or white readout that clears WCAG contrast
 * against that swatch. Neither function paints a theme surface.
 */

import {
  displayHexColor,
  formatHexColor,
  normalizeHexColor,
  parseHexColor,
  cssColor,
} from "../../../core/utils/colors.ts";

export { cssColor, displayHexColor, formatHexColor, normalizeHexColor, parseHexColor };

/** Normalize a stored colour to the `#rrggbb` form a colour input requires. */
export function normalizeColor(value: string): string {
  return normalizeHexColor(value);
}

/** Picker-ready channels from a committed hex draft, each normalized to 0..1. */
export interface ColorDraft {
  red: number;
  green: number;
  blue: number;
  /** Present only when the draft states an explicit alpha channel. */
  alpha?: number;
}

/**
 * Read a completed hex draft as picker state.
 *
 * The draft has to be a full three-, four-, six-, or eight-digit value. Three-
 * and six-digit text carries no alpha, so the caller keeps the alpha it already
 * had instead of letting a typed RGB value clear a transparency.
 */
export function readColorDraft(value: string): ColorDraft | null {
  const parsed = parseHexColor(value);
  if (!parsed) {
    return null;
  }
  return {
    red: parsed.red / 255,
    green: parsed.green / 255,
    blue: parsed.blue / 255,
    alpha: parsed.hasAlpha ? parsed.alpha : undefined,
  };
}

/** Pick the readout ink with the stronger WCAG contrast against a colour. */
export function colorInk(value: string): "dark" | "light" {
  const color = normalizeColor(value);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const black = (luminance + 0.05) / 0.05;
  const white = 1.05 / (luminance + 0.05);
  return black >= white ? "dark" : "light";
}
