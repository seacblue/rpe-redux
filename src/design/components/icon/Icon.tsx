/**
 * Icon primitive: resolves a catalog name or caller override to a mask-tinted
 * PNG shape and subscribes to runtime icon overrides. Sizing and accessible
 * naming stay with the caller.
 */
import { useSyncExternalStore, type CSSProperties, type HTMLAttributes } from "react";
import { assetUrl } from "../../../core/platform/assetUrl.ts";
import {
  canonicalIconName,
  iconOverridesRevision,
  iconSourceFor,
  subscribeIconOverrides,
} from "../../../core/platform/browser/iconOverrides.ts";
import { isSafePngDataUrl } from "../../../core/utils/pngDataSource.ts";
import { ICON_NAMES, type IconName, type IconReference } from "./iconAssets.ts";
export { ICON_NAMES, type IconName, type IconReference } from "./iconAssets.ts";
export type IconProps = { name: IconReference; size?: number; source?: string } & Pick<
  HTMLAttributes<HTMLSpanElement>,
  "className" | "style" | "id" | "role" | "tabIndex" | "aria-hidden" | "aria-describedby"
>;

/**
 * The URL one glyph is painted from.
 *
 * Theme packages are data, so a glyph may be a PNG data URL or a relative PNG
 * path into the package. Absolute URLs, other schemes, non-PNG data, and path
 * traversal are refused here as well as in the theme parser: a glyph must never
 * turn into a remote request or a script-capable source.
 */
export function resolveIconSource(name: IconReference, override?: string): string {
  if (!override) {
    return "";
  }
  if (override.startsWith("data:image/png;base64,")) {
    return isSafePngDataUrl(override) ? override : "";
  }
  // Package-relative paths resolve through the shared asset URL helper.
  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(override) &&
    !override.startsWith("//") &&
    !override.startsWith("/") &&
    !override.includes("\\") &&
    override.toLowerCase().endsWith(".png")
  ) {
    const segments = override.split("/");
    if (segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")) {
      return assetUrl(override);
    }
  }
  // Vite emits the built-in theme glyphs as same-origin URLs (sometimes with a
  // hash). Those are app-owned files; remote or non-PNG sources are not.
  try {
    const url = new URL(override, document.baseURI);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === location.origin &&
      url.pathname.toLowerCase().endsWith(".png")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/**
 * Every glyph is a PNG alpha mask whose ink comes from the surface.
 *
 * The mask keeps the source alpha and the element's background paints it with a
 * theme token, so the same artwork works on every palette and action state. The
 * source image is still the shape catalog; the renderer owns the ink.
 *
 * `size` is the glyph's authored size. It is published as `--icon-size` rather
 * than as a final width so the stylesheet can multiply it by the enclosing
 * region's `--ui-scale`: a taller toolbar or a wider inspector scales its glyphs
 * with its buttons instead of leaving them at the authored pixels.
 */
export function Icon({
  name,
  size = 18,
  source: override,
  className = "",
  style,
  ...props
}: IconProps) {
  useSyncExternalStore(subscribeIconOverrides, iconOverridesRevision, iconOverridesRevision);
  const source = resolveIconSource(name, override ?? iconSourceFor(name));
  const paint: CSSProperties & { "--redux-icon": string; "--icon-size": string } = {
    ...style,
    "--icon-size": `${size}px`,
    "--redux-icon": source ? 'url("' + source + '")' : "none",
  };
  return (
    <span
      {...props}
      className={"redux-icon " + className}
      style={paint}
      aria-hidden="true"
      draggable={false}
    />
  );
}

const ICON_NAME_SET = new Set<string>(ICON_NAMES);

/**
 * A glyph name that came from outside the app — a contributed action.
 *
 * The catalog is closed and the contributions are not, so an unknown name draws the
 * fallback glyph. The button keeps its shape and label.
 */
export function iconName(name: string): IconName {
  const canonical = canonicalIconName(name);
  return ICON_NAME_SET.has(canonical) ? (canonical as IconName) : "help";
}
