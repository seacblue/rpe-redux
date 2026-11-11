/**
 * The theme package format.
 *
 * A theme is data, not code: an id, the appearance family it belongs to, a map
 * of CSS custom properties, optional PNG glyphs, and an optional chrome recipe.
 * The chrome recipe selects host-authored surface, motion, and title-bar presets;
 * it never carries CSS, JavaScript, URLs, or free-form values. The built-in
 * looks ship as packages under `src/assets/themes/`, and a user package is the
 * same document dropped into one of the `themes/` roots — so there is exactly
 * one shape to validate and exactly one place that decides what a theme may
 * change.
 *
 * Icons travel with the theme for the same reason: a package may restyle the
 * glyphs its palette was designed for, keyed by the icon names the design system
 * already publishes.
 */

import { normalizeIconMap } from "../platform/browser/iconOverrides.ts";
import { isPackageName, type PackageName } from "../utils/packageName.ts";
import { isSafePngDataUrl } from "../utils/pngDataSource.ts";
import { parseChrome, type ThemeChrome } from "./chrome.ts";
import { THEME_COLOR_TOKENS } from "./colorTokens.ts";
import { parseThemeUi, type ThemeUi } from "./ui.ts";

export * from "./chrome.ts";

/** Schema version accepted by the package parser. */
export const THEME_SCHEMA_VERSION = 2;
/** Earlier schema accepted for already-installed packages. */
const LEGACY_THEME_SCHEMA_VERSION = 1;

/** Light or dark family a package declares. */
export type ThemeAppearance = "dark" | "light";

/**
 * The single package kind. The parser accepts an icon-only document
 * (`kind: "icons"`) and normalizes it into a dark theme package.
 */
export type ThemePackageKind = "theme";

/** States whose action foreground may be selected by a theme package. */
export const ACTION_FOREGROUND_STATES = [
  "resting",
  "hover",
  "focus",
  "pressed",
  "disabled",
  "emphasized",
] as const;

/** One interaction state's preferred action ink. */
export type ActionForegroundState = (typeof ACTION_FOREGROUND_STATES)[number];
/** Ink direction for one action state. */
export type ActionForegroundMode = "normal" | "inverse";
/** Complete state-to-ink rule declared by a package. */
export type ThemeActionForegroundRule = Readonly<
  Record<ActionForegroundState, ActionForegroundMode>
>;

/** Where a package was found; shown in settings and used to refuse edits. */
export type ThemeSource = "builtin" | "portable" | "resource" | "user";

/** A validated theme document with its discovery source. */
export interface ThemePackage {
  schemaVersion: number;
  kind: ThemePackageKind;
  id: string;
  name: PackageName;
  version: string;
  author?: string;
  appearance: ThemeAppearance;
  /** CSS custom properties, including the leading `--`. */
  colors: Readonly<Record<string, string>>;
  /** Selects the normal or inverse action ink for each interaction state. */
  actionForeground?: ThemeActionForegroundRule;
  /** Icon name to image URL (or data URL). Absent names keep the reference glyph. */
  icons: Readonly<Record<string, string>>;
  /** Layout, surface, and motion presets applied by the host. */
  chrome: ThemeChrome;
  /** Declarative slot/component replacements rendered by the host. */
  ui: ThemeUi;
  source: ThemeSource;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const COLOR_NAME_PATTERN = /^--[a-z0-9-]+$/i;
const COLOR_VALUE_PATTERN = /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\(\s*[\d.%\s,/]+\)|transparent)$/i;
const MAX_VALUE_LENGTH = 240;
const MAX_METADATA_LENGTH = 200;
const MAX_TOKEN_NAME_LENGTH = 64;
const MAX_COLOR_TOKENS = 512;
const MAX_ICON_OVERRIDES = 512;
const MAX_ICON_LENGTH = 512 * 1024;
const MAX_ICON_BYTES = 4 * 1024 * 1024;
const MIN_ACTION_CONTRAST = 4.5;
/**
 * Extension/package fields a theme may never declare.
 *
 * Themes are data-only presentation packages. They have no entry point, script
 * list, capability grant, dependency graph, or host-version gate; rejecting these
 * names keeps a theme from being mistaken for a code package.
 */
const FORBIDDEN_THEME_FIELDS: ReadonlySet<string> = new Set([
  "entry",
  "activate",
  "scripts",
  "capabilities",
  "dependencies",
  "conflicts",
  "permissions",
  "engines",
]);

/**
 * A theme may carry a PNG data URL or a package-relative `.png` reference.
 *
 * Remote URLs would turn a theme choice into a network/tracking request, and an
 * SVG data URL carries script-capable markup into the icon mask; neither belongs
 * in a data-only theme package. The bundled and exported packages already use
 * the two accepted forms.
 */
function isSafeThemeIconSource(value: string): boolean {
  if (!value || value.length > MAX_ICON_LENGTH) {
    return false;
  }
  if (value.startsWith("data:image/png;base64,")) {
    return isSafePngDataUrl(value);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return false;
  }
  if (value.includes("\\") || value.startsWith("/")) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    value.toLowerCase().endsWith(".png")
  );
}

/** Read an unknown value as a plain object, or null for arrays and primitives. */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trim a string field, returning an empty string for any other value. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validate a complete state rule; absent means no rule, invalid means null. */
function parseActionForegroundRule(value: unknown): ThemeActionForegroundRule | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const input = record(value);
  if (!input) {
    return null;
  }
  const rule = {} as Record<ActionForegroundState, ActionForegroundMode>;
  for (const state of ACTION_FOREGROUND_STATES) {
    const mode = input[state];
    if (mode !== "normal" && mode !== "inverse") {
      return null;
    }
    rule[state] = mode;
  }
  return rule;
}

type Rgb = readonly [number, number, number];

/** Parse `#rgb` or `#rrggbb` into channel values, or null for other formats. */
function parseHexColor(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (![3, 6].includes(hex.length) || !/^[\da-f]+$/i.test(hex)) {
    return null;
  }
  const expanded = hex.length === 3 ? hex.replace(/./g, (channel) => channel + channel) : hex;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance of an sRGB color. */
function relativeLuminance(value: Rgb): number {
  const channels = value
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio, or null when either color is not hex. */
function contrastRatio(background: string, foreground: string): number | null {
  const backgroundRgb = parseHexColor(background);
  const foregroundRgb = parseHexColor(foreground);
  if (!backgroundRgb || !foregroundRgb) {
    return null;
  }
  const lighter = Math.max(relativeLuminance(backgroundRgb), relativeLuminance(foregroundRgb));
  const darker = Math.min(relativeLuminance(backgroundRgb), relativeLuminance(foregroundRgb));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Chooses the theme's preferred action ink when it is readable, otherwise its
 * declared inverse. Keeping this rule in the package resolver means previews and
 * the live document use the same answer.
 */
function readableActionForeground(
  background: string | undefined,
  preferred: string | undefined,
  inverse: string | undefined,
): string | undefined {
  const candidates = [preferred, inverse].filter(
    (candidate, index, all): candidate is string =>
      Boolean(candidate) && all.indexOf(candidate) === index,
  );
  if (!candidates.length) {
    return undefined;
  }
  if (!background) {
    return preferred ?? inverse ?? candidates[0];
  }
  const preferredRatio = preferred ? contrastRatio(background, preferred) : null;
  if (preferredRatio !== null && preferredRatio >= MIN_ACTION_CONTRAST) {
    return preferred;
  }
  return candidates.reduce((best, candidate) => {
    const bestRatio = contrastRatio(background, best) ?? -1;
    const candidateRatio = contrastRatio(background, candidate) ?? -1;
    return candidateRatio > bestRatio ? candidate : best;
  });
}

/** Resolve one state's ink, falling back to the most readable neutral when needed. */
function resolveActionForeground(
  state: ActionForegroundState,
  rule: ThemeActionForegroundRule | undefined,
  background: string | undefined,
  normal: string | undefined,
  inverse: string | undefined,
): string | undefined {
  const mode = rule?.[state];
  if (mode) {
    const selected = mode === "inverse" ? inverse : normal;
    if (
      selected &&
      (!background ||
        (contrastRatio(background, selected) ?? Number.NEGATIVE_INFINITY) >= MIN_ACTION_CONTRAST)
    ) {
      return selected;
    }
  }
  // A declared mode is an intent, not permission to paint unreadable ink.
  // If it fails the 4.5:1 floor, use the strongest readable neutral instead.
  return readableActionForeground(background, normal, inverse);
}

/** Reject a package unless it fully validates; a half-read palette is not usable. */
export function parseThemePackage(value: unknown, source: ThemeSource): ThemePackage | null {
  const input = record(value);
  if (!input) {
    return null;
  }
  if (
    input.schemaVersion !== THEME_SCHEMA_VERSION &&
    input.schemaVersion !== LEGACY_THEME_SCHEMA_VERSION
  ) {
    return null;
  }
  if (
    Object.keys(input).some((key) => FORBIDDEN_THEME_FIELDS.has(key)) ||
    (input.kind !== undefined && input.kind !== "theme" && input.kind !== "icons")
  ) {
    return null;
  }
  const id = text(input.id);
  if (!ID_PATTERN.test(id)) {
    return null;
  }
  const name = input.name;
  if (!isPackageName(name)) {
    return null;
  }
  const version = text(input.version);
  const author = text(input.author);
  if (version.length > MAX_METADATA_LENGTH || author.length > MAX_METADATA_LENGTH) {
    return null;
  }
  const legacyIconPackage = input.kind === "icons";
  const kind: ThemePackageKind = "theme";
  const appearanceText = text(input.appearance);
  const appearance =
    appearanceText === "dark" || appearanceText === "light"
      ? appearanceText
      : legacyIconPackage
        ? "dark"
        : undefined;
  if (!appearance) {
    return null;
  }
  const actionForeground = parseActionForegroundRule(input.actionForeground);
  if (actionForeground === null) {
    return null;
  }
  const chrome = parseChrome(input.chrome);
  if (!chrome) {
    return null;
  }
  const ui = parseThemeUi(input.ui);
  if (!ui) {
    return null;
  }
  const rawColors = record(input.colors);
  if (!rawColors && !legacyIconPackage) {
    return null;
  }
  const colorEntries = Object.entries(rawColors ?? {});
  if (colorEntries.length > MAX_COLOR_TOKENS) {
    return null;
  }
  const colors: Record<string, string> = {};
  for (const [key, raw] of colorEntries) {
    const value = text(raw);
    if (
      key.length > MAX_TOKEN_NAME_LENGTH ||
      !COLOR_NAME_PATTERN.test(key) ||
      !THEME_COLOR_TOKENS.has(key) ||
      !value ||
      value.length > MAX_VALUE_LENGTH ||
      !COLOR_VALUE_PATTERN.test(value)
    ) {
      return null;
    }
    colors[key] = value;
  }
  const iconEntries = Object.entries(record(input.icons) ?? {});
  if (iconEntries.length > MAX_ICON_OVERRIDES) {
    return null;
  }
  const rawIcons: Record<string, string> = {};
  let iconBytes = 0;
  for (const [key, raw] of iconEntries) {
    const value = text(raw);
    if (!isSafeThemeIconSource(value)) {
      continue;
    }
    iconBytes += value.length;
    if (iconBytes > MAX_ICON_BYTES) {
      return null;
    }
    rawIcons[key] = value;
  }
  const icons = normalizeIconMap(rawIcons);
  if (legacyIconPackage && !Object.keys(icons).length) {
    return null;
  }
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    kind,
    id,
    name,
    version: version || "1.0.0",
    author: author || undefined,
    appearance,
    colors,
    ...(actionForeground ? { actionForeground } : {}),
    icons,
    chrome,
    ui,
    source,
  };
}

/**
 * A package only has to describe what it changes.
 *
 * The caller passes the built-in palette for the package's appearance, so a
 * package that only wants a different accent keeps the rest of the interface
 * readable in its own light or dark family.
 */
export function resolveThemeColors(
  base: Readonly<Record<string, string>>,
  packageColors: Readonly<Record<string, string>>,
  actionForeground?: ThemeActionForegroundRule,
): Record<string, string> {
  const colors = { ...base, ...packageColors };
  const inverse = colors["--on-accent-inverse"];
  const accent = colors["--accent"];
  const hover = colors["--accent-hover"] ?? colors["--accent-pressed"] ?? accent;
  const pressed = colors["--accent-pressed"] ?? accent;
  const normal = colors["--on-accent"];
  const hoverNormal = colors["--on-accent-hover"] ?? normal;
  const pressedNormal = colors["--on-accent-pressed"] ?? normal;

  const resting = resolveActionForeground("resting", actionForeground, accent, normal, inverse);
  const onAccentHover = resolveActionForeground(
    "hover",
    actionForeground,
    hover,
    hoverNormal,
    inverse,
  );
  const focus = resolveActionForeground(
    "focus",
    actionForeground,
    accent,
    colors["--on-accent-focus"] ?? normal,
    inverse,
  );
  const pressedForeground = resolveActionForeground(
    "pressed",
    actionForeground,
    pressed,
    pressedNormal,
    inverse,
  );
  const disabled = resolveActionForeground(
    "disabled",
    actionForeground,
    colors["--surface-muted"],
    colors["--on-accent-disabled"] ?? colors["--foreground-muted"],
    inverse,
  );
  const emphasized = resolveActionForeground(
    "emphasized",
    actionForeground,
    accent,
    colors["--on-accent-emphasized"] ?? normal,
    inverse,
  );

  return {
    ...colors,
    ...(hover ? { "--accent-hover": hover } : {}),
    ...(pressed ? { "--accent-pressed": pressed } : {}),
    ...(resting ? { "--on-accent": resting } : {}),
    ...(onAccentHover ? { "--on-accent-hover": onAccentHover } : {}),
    ...(pressedForeground ? { "--on-accent-pressed": pressedForeground } : {}),
    ...(resting ? { "--action-foreground-resting": resting } : {}),
    ...(onAccentHover ? { "--action-foreground-hover": onAccentHover } : {}),
    ...(focus ? { "--action-foreground-focus": focus } : {}),
    ...(pressedForeground ? { "--action-foreground-pressed": pressedForeground } : {}),
    ...(disabled ? { "--action-foreground-disabled": disabled } : {}),
    ...(emphasized ? { "--action-foreground-emphasized": emphasized } : {}),
  };
}
