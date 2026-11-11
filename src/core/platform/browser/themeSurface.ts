/**
 * The theme's single step into the document.
 *
 * `core/theme/` owns what a theme *is* (a package of CSS custom properties, an
 * appearance family, and a validated chrome recipe). Writing those properties
 * and preset names onto the document and telling the theme-aware controls to
 * re-read them is a host step, so it lives here.
 *
 * The event name is part of this seam: `redux-theme` is a DOM event, and its
 * listeners (the preview renderer, the settings window) are mounted independently
 * of whoever changed the theme.
 *
 * ```ts
 * applyThemeToDocument({ "--surface": "#0b0d12" }, "dark", "dark", chrome);
 * // document.documentElement.dataset.skin === "dark"
 * // document.documentElement.dataset.theme === "dark"
 * // document.documentElement.dataset.chromeMaterial === "glass"
 * ```
 */

import type { ThemeChrome } from "../../theme/packages.ts";

/** Which of the two document-level looks the styles key off. */
export type ThemeMode = "light" | "dark";

const applied = new Set<string>();

/**
 * Writes the palette, the theme id, the light/dark family, and the surface,
 * motion, and title-bar preset names, then announces it.
 *
 * The palette is applied as inline custom properties on the root element: the
 * stylesheets only ever read the tokens, so a package can replace every colour
 * without a stylesheet of its own. Properties the new theme does not define are
 * removed, so switching from a package with extra tokens does not leak them into
 * the next one. Chrome presets become `data-chrome-*` attributes; window layout
 * and measurements stay host-owned.
 */
export function applyThemeToDocument(
  colors: Readonly<Record<string, string>>,
  skin: string,
  mode: ThemeMode,
  chrome: ThemeChrome,
): void {
  const root = document.documentElement;
  for (const name of applied) {
    if (!(name in colors)) {
      root.style.removeProperty(name);
      applied.delete(name);
    }
  }
  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(name, value);
    applied.add(name);
  }
  root.style.colorScheme = mode;
  root.dataset.skin = skin;
  root.dataset.theme = mode;

  root.dataset.chromeShape = chrome.surface.shape;
  root.dataset.chromeMaterial = chrome.surface.material;
  root.dataset.chromePattern = chrome.surface.pattern;
  root.dataset.chromeAmbient = chrome.surface.ambient;
  root.dataset.chromeMotion = chrome.motion.level;
  root.dataset.chromeSpeed = chrome.motion.speed;
  root.dataset.chromeHover = chrome.motion.hover;
  root.dataset.chromeEntrance = chrome.motion.entrance;
  root.dataset.chromeWindowControls = chrome.titlebar.windowControls;
  root.dataset.chromeMenu = chrome.titlebar.menu;
  root.style.setProperty("--theme-backdrop-blur", `${chrome.surface.backdropBlur}px`);

  window.dispatchEvent(new Event("redux-theme"));
}
