/**
 * Owns the read-only design-token facade Extensions use to match the host UI.
 *
 * The host publishes one snapshot of the tokens it actually applied to the
 * document. Values are read from the live token surface by the frontend seam,
 * never from a hand-maintained copy, so a theme package change reaches package
 * surfaces with the same values the host chrome uses.
 */
import { createLateBound } from "../utils/lateBound.ts";
import type { ExtensionDisposer } from "../extensions/registry.ts";

/** The active theme identity shown to an Extension. */
export interface ExtensionThemeIdentity {
  /** Active theme package id, for example `dark`. */
  readonly id: string;
  /** Localized display name of the active package. */
  readonly name: string;
  /** Painted light/dark family. */
  readonly appearance: "light" | "dark";
}

/** Colour roles a package should use instead of raw colour values. */
export type ExtensionThemeColorRole =
  | "foreground"
  | "background"
  | "panel"
  | "border"
  | "accent"
  | "danger"
  | "warning"
  | "success"
  | "muted";

/** Official token snapshot handed to a package. */
export interface ExtensionThemeTokens {
  /** Theme id, name, and appearance. */
  readonly theme: ExtensionThemeIdentity;
  /** Semantic colour values as CSS colour strings. */
  readonly colors: Readonly<Record<ExtensionThemeColorRole, string>>;
  /** Corner radii by semantic role. */
  readonly radii: Readonly<Record<string, string>>;
  /** Spacing scale by step name. */
  readonly spacing: Readonly<Record<string, string>>;
  /** Font family and reading-size scale. */
  readonly fonts: {
    readonly family: string;
    readonly monoFamily: string;
    readonly sizes: Readonly<Record<string, string>>;
  };
  /** Elevation shadows by surface role. */
  readonly shadows: Readonly<Record<string, string>>;
  /** Motion durations and easing curves. */
  readonly motion: {
    readonly durations: Readonly<Record<string, string>>;
    readonly easings: Readonly<Record<string, string>>;
  };
}

/** Host seam that reads the live token surface and announces changes. */
export interface ExtensionThemeTokenHost {
  /** Build a fresh snapshot from the values currently applied to the document. */
  tokens(): ExtensionThemeTokens;
  /** Observe theme changes; returns a host-only disposer. */
  subscribe(listener: () => void): ExtensionDisposer;
}

/** CSS custom properties behind each semantic colour role. */
const COLOR_TOKENS: Readonly<Record<ExtensionThemeColorRole, string>> = Object.freeze({
  foreground: "--foreground",
  background: "--surface",
  panel: "--surface-raised",
  border: "--panel-border",
  accent: "--accent",
  danger: "--danger",
  warning: "--warning",
  success: "--playing-indicator",
  muted: "--foreground-muted",
});

/** Corner radius roles published to packages. */
const RADIUS_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  panel: "--radius-panel",
  control: "--radius-control",
  micro: "--design-radius-micro",
  chip: "--design-radius-chip",
  inline: "--design-radius-inline",
  overlay: "--design-radius-overlay",
});

/** Spacing scale published to packages. */
const SPACING_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  "1": "--space-1",
  "1.5": "--space-1-5",
  "2": "--space-2",
  "2.5": "--space-2-5",
  "3": "--space-3",
  "4": "--space-4",
  "5": "--space-5",
  "6": "--space-6",
  "7": "--space-7",
});

/** Reading-size scale published to packages. */
const FONT_SIZE_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  micro: "--type-micro",
  caption: "--type-caption",
  label: "--type-label",
  body: "--type-body",
  heading: "--type-heading",
  title: "--type-title",
  hero: "--type-hero",
  display: "--type-display",
});

/** Elevation roles published to packages. */
const SHADOW_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  panel: "--shadow-panel",
  overlayPanel: "--shadow-overlay-panel",
  overlayPopover: "--shadow-overlay-popover",
  drawerEdge: "--shadow-drawer-edge",
  tooltip: "--shadow-overlay-tooltip",
  popover: "--popover-shadow",
});

/** Motion duration roles published to packages. */
const DURATION_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  tint: "--design-dur-tint",
  overlay: "--design-dur-overlay",
  search: "--design-dur-search",
  enter: "--design-dur-enter",
  exit: "--design-dur-exit",
  disclosure: "--design-dur-disclosure",
});

/** Easing roles published to packages. */
const EASING_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  move: "--design-ease-move",
  enter: "--design-ease-enter",
  exit: "--design-ease-exit",
  bounce: "--design-ease-bounce",
});

/** Normalize one token read to a JSON string; missing values become empty. */
function token(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Read one token-name table through the live source. */
function tokenTable(
  names: Readonly<Record<string, string>>,
  read: (variable: string) => unknown,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(names).map(([key, variable]) => [key, token(read(variable))]),
    ),
  );
}

/**
 * Build one immutable token snapshot from live CSS custom-property values.
 *
 * `read` is the host's token reader; the frontend passes `getComputedStyle` on
 * the document root. Package code only ever receives JSON strings, so a new
 * token cannot smuggle a host object across the bridge.
 */
export function buildExtensionThemeTokens(
  identity: ExtensionThemeIdentity,
  read: (variable: string) => unknown,
): ExtensionThemeTokens {
  const appearance = identity.appearance === "light" ? "light" : "dark";
  return Object.freeze({
    theme: Object.freeze({
      id: token(identity.id),
      name: token(identity.name),
      appearance,
    }),
    colors: tokenTable(COLOR_TOKENS, read) as Readonly<Record<ExtensionThemeColorRole, string>>,
    radii: tokenTable(RADIUS_TOKENS, read),
    spacing: tokenTable(SPACING_TOKENS, read),
    fonts: Object.freeze({
      family: token(read("font-family")),
      monoFamily: token(read("--font-mono")),
      sizes: tokenTable(FONT_SIZE_TOKENS, read),
    }),
    shadows: tokenTable(SHADOW_TOKENS, read),
    motion: Object.freeze({
      durations: tokenTable(DURATION_TOKENS, read),
      easings: tokenTable(EASING_TOKENS, read),
    }),
  });
}

const tokenHost = createLateBound<ExtensionThemeTokenHost>();

/** Attach the frontend-owned token reader before packaged Extensions load. */
export function connectExtensionThemeTokens(host: ExtensionThemeTokenHost): () => void {
  return tokenHost.bind(host);
}

/** Resolve the connected token host or fail with a stable host message. */
function requireTokenHost(): ExtensionThemeTokenHost {
  const host = tokenHost.value();
  if (!host) {
    throw new Error("Extension theme token host is unavailable");
  }
  return host;
}

/**
 * The public design-token handle.
 *
 * `tokens` is a synchronous read on the host facade and becomes a promise in
 * the sandbox. `subscribe` returns a disposer for host lifecycle management;
 * the capability gate hides that disposer from package code, so a package
 * cannot detach its listener from the activation.
 */
export const theme = Object.freeze({
  /** Read the token values currently applied to the document. */
  tokens: (): ExtensionThemeTokens => requireTokenHost().tokens(),
  /** Observe theme changes; returns a host-only disposer. */
  subscribe: (listener: () => void): (() => void) => requireTokenHost().subscribe(listener),
});
