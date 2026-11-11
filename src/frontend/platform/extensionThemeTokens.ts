/**
 * Publishes the design tokens the host has actually applied to the document.
 *
 * The snapshot is read from the root element's computed custom properties, so
 * it follows the active theme package, chrome shape, and motion recipe without
 * a second token table. A theme repaint announces itself through the
 * `redux-theme` event owned by `core/platform/browser/themeSurface.ts`.
 */
import {
  buildExtensionThemeTokens,
  connectExtensionThemeTokens,
  type ExtensionThemeIdentity,
  type ExtensionThemeTokens,
} from "../../core/api/theme.ts";
import { getTheme } from "../../core/theme/themes.ts";
import { packageName } from "../../core/utils/packageName.ts";
import { getLanguage } from "../../i18n/index.ts";

/** Read the active theme identity from the attributes the theme surface writes. */
function readIdentity(): ExtensionThemeIdentity {
  const root = document.documentElement;
  const id = root.dataset.skin || "dark";
  const definition = getTheme(id);
  return {
    id,
    name: (definition && packageName(definition.name, getLanguage())) || id,
    appearance: root.dataset.theme === "light" ? "light" : "dark",
  };
}

/** Read every published token from the root element's computed style. */
function readTokens(): ExtensionThemeTokens {
  const style = getComputedStyle(document.documentElement);
  return buildExtensionThemeTokens(readIdentity(), (variable) => style.getPropertyValue(variable));
}

/** Installs the live token reader and its theme-change subscription. */
export function installExtensionThemeTokens(): () => void {
  return connectExtensionThemeTokens({
    tokens: readTokens,
    subscribe(listener) {
      const onTheme = () => listener();
      window.addEventListener("redux-theme", onTheme);
      return () => window.removeEventListener("redux-theme", onTheme);
    },
  });
}
