/**
 * Installs note-skin loading and change notification for the webview build.
 *
 * Bundled asset URLs and the DOM event that announces a new skin are platform
 * facts, so they are supplied to `core/media` from here.
 */
import {
  DEFAULT_NOTE_SKIN,
  EXTERNAL_NOTE_SKIN_PREFIX,
  setBundledNoteSkinLoader,
  setExternalNoteSkinLoader,
  setNoteSkinChangeNotifier,
  setNoteSkinFallbackSources,
  type LoadedNoteSkin,
} from "../../core/media/noteSkins.ts";
import { parseNoteSkin } from "../../core/media/noteSkin.ts";
import {
  builtinNoteSkinPackageId,
  externalNoteSkins,
  readExternalNoteSkin,
} from "../../core/platform/desktop/noteSkinPackages.ts";
import { packageSlug, type PackageName } from "../../core/utils/packageName.ts";
import { t } from "../../i18n/index.ts";

/**
 * The browser half of the note-skin story.
 *
 * Three things about skins are not domain and so cannot live in `core/media/`:
 * the assets compiled into the build (a bundler glob), the URL they resolve to
 * (a `document` concern), and telling the rest of the interface that the active
 * skin changed (a DOM event). They are here, behind one installer that hands the
 * media layer the two capabilities it needs.
 */

/** Folder of the built-in package inside the source tree and the packaged site. */
const BUNDLED_SKIN_FOLDER = "built_in_original";

/** Last-resort display name when the bundled package cannot be read at all. */
const BUNDLED_NAME_FALLBACK = "Built-in - Original";

const bundledLineAssets =
  import.meta.env?.DEV || import.meta.env?.PROD
    ? import.meta.glob<string>("../../assets/skins/built_in_original/line.png", {
        eager: true,
        query: "?url",
        import: "default",
      })
    : {};

/** The built-in judgement line texture the bundled skin ships. */
export const DEFAULT_BUNDLED_LINE_TEXTURE_URL =
  Object.entries(bundledLineAssets ?? {}).find(([path]) => path.endsWith("/line.png"))?.[1] ?? "";

/** The interface's note-skin-changed event; the shell and the preview both listen. */
export const NOTE_SKIN_EVENT = "redux:note-skin-changed";

/** Canonical files shipped by the built-in Phira resource pack. */
const BUNDLED_PHIRA_FILES = [
  "info.yml",
  "click.png",
  "click_mh.png",
  "drag.png",
  "drag_mh.png",
  "flick.png",
  "flick_mh.png",
  "hold.png",
  "hold_mh.png",
  "hit_fx.png",
  "event_hold.png",
  "click.ogg",
  "drag.ogg",
  "flick.ogg",
  "line.png",
] as const;

/** Resolve a built-in skin file in Vite dev or from the packaged site root. */
export function bundledNoteSkinUrl(path: string): string {
  const url = import.meta.env?.DEV
    ? `/src/assets/skins/${BUNDLED_SKIN_FOLDER}/${path}`
    : `skins/${BUNDLED_SKIN_FOLDER}/${path}`;
  return new URL(url, document.baseURI).href;
}

/**
 * The layouts a built-in skin can be served from.
 *
 * The dev server exposes the source folder while the packaged site serves the
 * copied one; a portable archive or a hosted build can end up on either. Both
 * bases are tried so the skin stays available when only one is reachable.
 */
function bundledSkinBases(): URL[] {
  const paths = import.meta.env?.DEV
    ? [`/src/assets/skins/${BUNDLED_SKIN_FOLDER}/`, `skins/${BUNDLED_SKIN_FOLDER}/`]
    : [`skins/${BUNDLED_SKIN_FOLDER}/`, `/src/assets/skins/${BUNDLED_SKIN_FOLDER}/`];
  return [...new Set(paths)].map((path) => new URL(path, document.baseURI));
}

/** Fetches and parses the default skin from one candidate base URL. */
async function loadBundledDefaultSkinAt(base: URL): Promise<LoadedNoteSkin> {
  const files = new Map<string, Uint8Array>();
  const optional = new Set(["event_hold.png", "line.png"]);
  await Promise.all(
    BUNDLED_PHIRA_FILES.map(async (name) => {
      const response = await fetch(new URL(name, base));
      if (!response.ok) {
        if (optional.has(name)) {
          return;
        }
        throw new Error(t("settings.skin.error.bundledAssetUnavailable", { name }));
      }
      files.set(name, new Uint8Array(await response.arrayBuffer()));
    }),
  );
  if (!files.has("info.yml")) {
    throw new Error(t("settings.skin.error.bundledUnavailable", { status: 404 }));
  }
  const manifest = parseNoteSkin(files);
  return {
    id: DEFAULT_NOTE_SKIN,
    packageId: packageSlug(manifest.name),
    source: "compiled",
    manifest,
    files,
  };
}

/**
 * Reads the built-in package through the host.
 *
 * The built-in is one package identity: a saved edit lives in the writable
 * skin root under the built-in id, and the host's user-root-first scan returns
 * that override ahead of the shipped copy. Returns null when the host has no
 * such package, so the caller can fall back to the assets compiled with the
 * web build.
 */
async function loadHostBundledSkin(): Promise<LoadedNoteSkin | null> {
  try {
    const packageId = await builtinNoteSkinPackageId();
    const { files, source } = await readExternalNoteSkin(packageId);
    const manifest = parseNoteSkin(files);
    return { id: DEFAULT_NOTE_SKIN, packageId, source, manifest, files };
  } catch {
    return null;
  }
}

// The bundled pack ships with the build, so it is loaded and validated once and
// shared by every consumer: hit sounds, the editor skin, and the settings
// preview. A change event clears both caches because a same-id override can
// replace the bytes the cached copy was parsed from.
let bundledCache: Promise<LoadedNoteSkin> | null = null;
let bundledNameCache: Promise<PackageName> | null = null;

/** The built-in skin's self-provided name, from the loaded package. */
export function bundledNoteSkinName(): Promise<PackageName> {
  bundledNameCache ??= loadBundledDefaultSkin().then(
    (pack) => pack.manifest.name,
    () => BUNDLED_NAME_FALLBACK,
  );
  return bundledNameCache;
}

/** Loads and caches the default skin: the host override first, then the bundle. */
async function loadBundledDefaultSkin(): Promise<LoadedNoteSkin> {
  if (bundledCache) {
    return bundledCache;
  }
  const hostPack = await loadHostBundledSkin();
  if (hostPack) {
    bundledCache = Promise.resolve(hostPack);
    return hostPack;
  }
  let failure: unknown = null;
  for (const base of bundledSkinBases()) {
    try {
      const pack = await loadBundledDefaultSkinAt(base);
      bundledCache = Promise.resolve(pack);
      return pack;
    } catch (error) {
      // Keep the first failure, which names the layout this build targets; the
      // fallback usually reports the served index page instead.
      failure ??= error;
    }
  }
  throw failure ?? new Error(t("settings.skin.error.bundledUnavailable", { status: 0 }));
}

/**
 * Hand the browser capabilities to `core/media`. Call once, before the editor
 * mounts: loading a skin can happen as early as the hit sounds.
 */
export function installNoteSkinBridge(): void {
  setBundledNoteSkinLoader(loadBundledDefaultSkin);
  setExternalNoteSkinLoader(async (id) => {
    const { files, source } = await readExternalNoteSkin(id);
    return {
      id: `${EXTERNAL_NOTE_SKIN_PREFIX}${id}`,
      packageId: id,
      source,
      manifest: parseNoteSkin(files, { allowIncomplete: true }),
      files,
    };
  });
  setNoteSkinFallbackSources(() => [
    DEFAULT_NOTE_SKIN,
    ...externalNoteSkins().map((skin) => `${EXTERNAL_NOTE_SKIN_PREFIX}${skin.id}`),
  ]);
  setNoteSkinChangeNotifier(() => {
    bundledCache = null;
    bundledNameCache = null;
    window.dispatchEvent(new Event(NOTE_SKIN_EVENT));
  });
}
