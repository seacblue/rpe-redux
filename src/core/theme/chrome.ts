/**
 * The theme chrome recipe vocabulary and parser.
 *
 * The recipe covers presentation only: surface material, motion budget, and
 * caption/menu framing. The host owns the window layout, so a package cannot
 * move the inspector, rail, toolbar, transport, or status bar. Every member is a
 * closed preset or a bounded integer; a package never supplies style text,
 * markup, or executable values.
 */

/** Corner scale. */
export const THEME_SHAPES = ["square", "soft", "round"] as const;
export type ThemeShape = (typeof THEME_SHAPES)[number];

/** Panel material presets. */
export const THEME_MATERIALS = ["solid", "raised", "glass", "flat"] as const;
export type ThemeMaterial = (typeof THEME_MATERIALS)[number];

/** Workbench backdrop patterns drawn from theme tokens. */
export const THEME_PATTERNS = ["none", "grid", "dots", "scanlines"] as const;
export type ThemePattern = (typeof THEME_PATTERNS)[number];

/** Decorative ambient layers drawn from theme tokens. */
export const THEME_AMBIENTS = ["none", "aurora", "pulse"] as const;
export type ThemeAmbient = (typeof THEME_AMBIENTS)[number];

/** Overall motion budget. */
export const THEME_MOTION_LEVELS = ["none", "subtle", "expressive"] as const;
export type ThemeMotionLevel = (typeof THEME_MOTION_LEVELS)[number];

/** Duration multiplier preset. */
export const THEME_MOTION_SPEEDS = ["slow", "normal", "fast"] as const;
export type ThemeMotionSpeed = (typeof THEME_MOTION_SPEEDS)[number];

/** Pointer feedback on action surfaces. */
export const THEME_HOVER_EFFECTS = ["none", "lift", "glow"] as const;
export type ThemeHoverEffect = (typeof THEME_HOVER_EFFECTS)[number];

/** Entrance animation for the main panels. */
export const THEME_ENTRANCES = ["none", "fade", "rise", "slide"] as const;
export type ThemeEntrance = (typeof THEME_ENTRANCES)[number];

/** Caption-button framing for minimize, maximize, and close. */
export const THEME_WINDOW_CONTROL_STYLES = ["system", "compact", "capsule"] as const;
export type ThemeWindowControlStyle = (typeof THEME_WINDOW_CONTROL_STYLES)[number];

/** Application-menu presentation: one hamburger or expanded section triggers. */
export const THEME_MENU_STYLES = ["hamburger", "expanded"] as const;
export type ThemeMenuStyle = (typeof THEME_MENU_STYLES)[number];

/** Surface presets the theme picks for panel paint. */
export interface ThemeChromeSurface {
  shape: ThemeShape;
  material: ThemeMaterial;
  /** Backdrop blur in CSS pixels, bounded by the parser. */
  backdropBlur: number;
  pattern: ThemePattern;
  ambient: ThemeAmbient;
}

/** Motion presets the theme picks for transitions and entrances. */
export interface ThemeChromeMotion {
  level: ThemeMotionLevel;
  speed: ThemeMotionSpeed;
  hover: ThemeHoverEffect;
  entrance: ThemeEntrance;
}

/** Title-bar framing: caption-button grouping and menu presentation. */
export interface ThemeChromeTitlebar {
  windowControls: ThemeWindowControlStyle;
  /** One hamburger sheet or the section labels as a classic menu bar. */
  menu: ThemeMenuStyle;
}

/**
 * The validated chrome recipe carried by a theme package.
 *
 * Every member is a closed preset. The renderer maps these names onto CSS and
 * React slots that ship with the host. Window placement and measurements are
 * host-owned, so the recipe cannot resize or rearrange the frame.
 */
export interface ThemeChrome {
  surface: ThemeChromeSurface;
  motion: ThemeChromeMotion;
  titlebar: ThemeChromeTitlebar;
}

/** The chrome recipe used when a package omits the optional block. */
export const DEFAULT_THEME_CHROME: ThemeChrome = Object.freeze({
  surface: Object.freeze({
    shape: "soft",
    material: "solid",
    backdropBlur: 0,
    pattern: "none",
    ambient: "none",
  }),
  motion: Object.freeze({
    level: "subtle",
    speed: "normal",
    hover: "none",
    entrance: "fade",
  }),
  titlebar: Object.freeze({
    windowControls: "system",
    menu: "expanded",
  }),
});

const MAX_BACKDROP_BLUR = 24;

/**
 * Keys the chrome block accepts.
 *
 * `layout` and `metrics` are retired layout controls. They stay accepted so an
 * installed package that still carries them keeps its palette and surface, but
 * their values are ignored.
 */
const CHROME_KEYS: ReadonlySet<string> = new Set([
  "surface",
  "motion",
  "titlebar",
  "layout",
  "metrics",
]);
const CHROME_SURFACE_KEYS: ReadonlySet<string> = new Set([
  "shape",
  "material",
  "backdropBlur",
  "pattern",
  "ambient",
]);
const CHROME_MOTION_KEYS: ReadonlySet<string> = new Set(["level", "speed", "hover", "entrance"]);
/** `density` is a retired title-bar height control and is accepted but ignored. */
const CHROME_TITLEBAR_KEYS: ReadonlySet<string> = new Set(["windowControls", "menu", "density"]);

/** Read an unknown value as a plain object, or null for arrays and primitives. */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read one member of a closed enum, applying the default when absent. */
function chromeEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T | null {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** True when a group contains only the keys its contract documents. */
function hasOnlyKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(input).every((key) => allowed.has(key));
}

/** Parse the title-row presets; absent keeps the documented frame. */
function parseTitlebar(value: unknown): ThemeChromeTitlebar | null {
  if (value === undefined) {
    return DEFAULT_THEME_CHROME.titlebar;
  }
  const input = record(value);
  if (!input || !hasOnlyKeys(input, CHROME_TITLEBAR_KEYS)) {
    return null;
  }
  const windowControls = chromeEnum(
    input,
    "windowControls",
    THEME_WINDOW_CONTROL_STYLES,
    DEFAULT_THEME_CHROME.titlebar.windowControls,
  );
  const menu = chromeEnum(input, "menu", THEME_MENU_STYLES, DEFAULT_THEME_CHROME.titlebar.menu);
  return windowControls && menu ? { windowControls, menu } : null;
}

/** Parse the optional chrome recipe; absent means the documented defaults. */
export function parseChrome(value: unknown): ThemeChrome | null {
  if (value === undefined) {
    return DEFAULT_THEME_CHROME;
  }
  const input = record(value);
  if (!input || !hasOnlyKeys(input, CHROME_KEYS)) {
    return null;
  }

  const surfaceInput = input.surface === undefined ? {} : record(input.surface);
  if (surfaceInput === null || !hasOnlyKeys(surfaceInput, CHROME_SURFACE_KEYS)) {
    return null;
  }
  const shape = chromeEnum(surfaceInput, "shape", THEME_SHAPES, DEFAULT_THEME_CHROME.surface.shape);
  const material = chromeEnum(
    surfaceInput,
    "material",
    THEME_MATERIALS,
    DEFAULT_THEME_CHROME.surface.material,
  );
  const pattern = chromeEnum(
    surfaceInput,
    "pattern",
    THEME_PATTERNS,
    DEFAULT_THEME_CHROME.surface.pattern,
  );
  const ambient = chromeEnum(
    surfaceInput,
    "ambient",
    THEME_AMBIENTS,
    DEFAULT_THEME_CHROME.surface.ambient,
  );
  if (!shape || !material || !pattern || !ambient) {
    return null;
  }
  let backdropBlur = DEFAULT_THEME_CHROME.surface.backdropBlur;
  if (surfaceInput.backdropBlur !== undefined) {
    const raw = surfaceInput.backdropBlur;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_BACKDROP_BLUR) {
      return null;
    }
    backdropBlur = raw;
  }

  const motionInput = input.motion === undefined ? {} : record(input.motion);
  if (motionInput === null || !hasOnlyKeys(motionInput, CHROME_MOTION_KEYS)) {
    return null;
  }
  const level = chromeEnum(
    motionInput,
    "level",
    THEME_MOTION_LEVELS,
    DEFAULT_THEME_CHROME.motion.level,
  );
  const speed = chromeEnum(
    motionInput,
    "speed",
    THEME_MOTION_SPEEDS,
    DEFAULT_THEME_CHROME.motion.speed,
  );
  const hover = chromeEnum(
    motionInput,
    "hover",
    THEME_HOVER_EFFECTS,
    DEFAULT_THEME_CHROME.motion.hover,
  );
  const entrance = chromeEnum(
    motionInput,
    "entrance",
    THEME_ENTRANCES,
    DEFAULT_THEME_CHROME.motion.entrance,
  );
  if (!level || !speed || !hover || !entrance) {
    return null;
  }

  const titlebar = parseTitlebar(input.titlebar);
  if (!titlebar) {
    return null;
  }

  return {
    surface: { shape, material, backdropBlur, pattern, ambient },
    motion: { level, speed, hover, entrance },
    titlebar,
  };
}
