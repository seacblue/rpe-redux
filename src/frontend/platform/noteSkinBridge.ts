/**
 * Installs note-skin loading and change notification for the webview build.
 *
 * Bundled asset URLs and the DOM event that announces a new skin are platform
 * facts, so they are supplied to `core/media` from here.
 */
import {
  BUILTIN_NOTE_SKIN_PACKAGE_IDS,
  DEFAULT_BUILTIN_NOTE_SKIN_PACKAGE_ID,
  EXTERNAL_NOTE_SKIN_PREFIX,
  builtinNoteSkinSelectionId,
  setBundledNoteSkinLoader,
  setExternalNoteSkinLoader,
  setNoteSkinChangeNotifier,
  setNoteSkinFallbackSources,
  type LoadedNoteSkin,
} from "../../core/media/noteSkins.ts";
import { parseNoteSkin } from "../../core/media/noteSkin.ts";
import {
  externalNoteSkins,
  readExternalNoteSkin,
} from "../../core/platform/desktop/noteSkinPackages.ts";
import type { PackageName } from "../../core/utils/packageName.ts";
import { t } from "../../i18n/index.ts";
import reducerCellsInfo from "../../assets/skins/builtin_reducer_cells/info.yml?raw";
import phiskinInfo from "../../assets/skins/builtin_phiskin/info.yml?raw";
import { NOTE_SKIN_EVENT } from "./noteSkinEvents.ts";

export { NOTE_SKIN_EVENT } from "./noteSkinEvents.ts";

/**
 * The browser half of the note-skin story.
 *
 * Three things about skins are not domain and so cannot live in `core/media/`:
 * the assets compiled into the build (a bundler glob), the URL they resolve to
 * (a `document` concern), and telling the rest of the interface that the active
 * skin changed (a DOM event). They are here, behind one installer that hands the
 * media layer the two capabilities it needs.
 */

/** One built-in package's source folder, manifest, and last-resort display name. */
interface BundledSkinDefinition {
  packageId: string;
  folder: string;
  info: string;
  fallbackName: string;
}

/** Shipped packages in the same order used for default selection and fallback. */
const BUNDLED_SKINS: readonly BundledSkinDefinition[] = [
  {
    packageId: BUILTIN_NOTE_SKIN_PACKAGE_IDS[0],
    folder: "builtin_reducer_cells",
    info: reducerCellsInfo,
    fallbackName: "Reducer Cells",
  },
  {
    packageId: BUILTIN_NOTE_SKIN_PACKAGE_IDS[1],
    folder: "builtin_phiskin",
    info: phiskinInfo,
    fallbackName: "Phiskin ~ 圆角简约",
  },
];

/** The default package's folder remains the source for the judge-line shortcut. */
const DEFAULT_BUNDLED_SKIN_FOLDER = "builtin_reducer_cells";

const bundledLineAssets =
  import.meta.env?.DEV || import.meta.env?.PROD
    ? import.meta.glob<string>("../../assets/skins/builtin_reducer_cells/line.png", {
        eager: true,
        query: "?url",
        import: "default",
      })
    : {};

/** The built-in judgement line texture the bundled skin ships. */
export const DEFAULT_BUNDLED_LINE_TEXTURE_URL =
  Object.entries(bundledLineAssets ?? {}).find(([path]) => path.endsWith("/line.png"))?.[1] ?? "";

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
    ? `/src/assets/skins/${DEFAULT_BUNDLED_SKIN_FOLDER}/${path}`
    : `skins/${DEFAULT_BUNDLED_SKIN_FOLDER}/${path}`;
  return new URL(url, document.baseURI).href;
}

/**
 * The layouts a built-in skin can be served from.
 *
 * The dev server exposes the source folder while the packaged site serves the
 * copied one; a portable archive or a hosted build can end up on either. Both
 * bases are tried so the skin stays available when only one is reachable.
 */
function bundledSkinBases(definition: BundledSkinDefinition): URL[] {
  const paths = import.meta.env?.DEV
    ? [`/src/assets/skins/${definition.folder}/`, `skins/${definition.folder}/`]
    : [`skins/${definition.folder}/`, `/src/assets/skins/${definition.folder}/`];
  return [...new Set(paths)].map((path) => new URL(path, document.baseURI));
}

/** Fetches and parses the default skin from one candidate base URL. */
async function loadBundledSkinAt(
  definition: BundledSkinDefinition,
  base: URL,
): Promise<LoadedNoteSkin> {
  const files = new Map<string, Uint8Array>();
  const optional = new Set(["event_hold.png", "line.png", "click.ogg", "drag.ogg", "flick.ogg"]);
  await Promise.all(
    BUNDLED_PHIRA_FILES.map(async (name) => {
      // A portable host can answer an unknown asset extension with the SPA
      // index (200 text/html), so fetching the manifest silently breaks the
      // whole skin. The manifest is compiled with the app instead.
      if (name === "info.yml") {
        files.set(name, new TextEncoder().encode(definition.info));
        return;
      }
      const response = await fetch(new URL(name, base));
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const expectedType = name.endsWith(".png") ? "image/png" : "audio/ogg";
      if (!response.ok || !contentType.includes(expectedType)) {
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
    id: builtinNoteSkinSelectionId(definition.packageId),
    packageId: definition.packageId,
    source: "compiled",
    manifest,
    files,
  };
}

/**
 * Reads the built-in package through the host.
 *
 * A saved edit lives in the writable skin root under the selected built-in id,
 * and the host's user-root-first scan returns that override ahead of the
 * shipped copy. Returns null when the host has no such package, so the caller
 * can fall back to the assets compiled with the web build.
 */
async function loadHostBundledSkin(packageId: string): Promise<LoadedNoteSkin | null> {
  try {
    const { files, source } = await readExternalNoteSkin(packageId);
    const manifest = parseNoteSkin(files);
    return {
      id: builtinNoteSkinSelectionId(packageId),
      packageId,
      source,
      manifest,
      files,
    };
  } catch {
    return null;
  }
}

// The bundled pack ships with the build, so it is loaded and validated once and
// shared by every consumer: hit sounds, the editor skin, and the settings
// preview. A change event clears both caches because a same-id override can
// replace the bytes the cached copy was parsed from.
const bundledCache = new Map<string, Promise<LoadedNoteSkin>>();
let bundledNameCache: Promise<PackageName> | null = null;

/** The built-in skin's self-provided name, from the loaded package. */
export function bundledNoteSkinName(): Promise<PackageName> {
  bundledNameCache ??= loadBundledSkin(DEFAULT_BUILTIN_NOTE_SKIN_PACKAGE_ID).then(
    (pack) => pack.manifest.name,
    () => BUNDLED_SKINS[0].fallbackName,
  );
  return bundledNameCache;
}

/** One selectable built-in package and its display name. */
export interface BundledNoteSkinSummary {
  readonly id: string;
  readonly packageId: string;
  readonly name: PackageName;
}

/** List every shipped skin in default and fallback order. */
export async function bundledNoteSkins(): Promise<readonly BundledNoteSkinSummary[]> {
  return Promise.all(
    BUNDLED_SKINS.map(async (definition) => ({
      id: builtinNoteSkinSelectionId(definition.packageId),
      packageId: definition.packageId,
      name: await loadBundledSkin(definition.packageId).then(
        (pack) => pack.manifest.name,
        () => definition.fallbackName,
      ),
    })),
  );
}

/** Loads and caches one built-in skin: the host override first, then the bundle. */
async function loadBundledSkin(
  packageId: string = DEFAULT_BUILTIN_NOTE_SKIN_PACKAGE_ID,
): Promise<LoadedNoteSkin> {
  const cached = bundledCache.get(packageId);
  if (cached) {
    return cached;
  }
  const definition = BUNDLED_SKINS.find((candidate) => candidate.packageId === packageId);
  if (!definition) {
    throw new Error(`Unknown built-in note skin: ${packageId}`);
  }
  const loading = (async () => {
    const hostPack = await loadHostBundledSkin(packageId);
    if (hostPack) {
      return hostPack;
    }
    let failure: unknown = null;
    for (const base of bundledSkinBases(definition)) {
      try {
        return await loadBundledSkinAt(definition, base);
      } catch (error) {
        // Keep the first failure, which names the layout this build targets; the
        // fallback usually reports the served index page instead.
        failure ??= error;
      }
    }
    throw failure ?? new Error(t("settings.skin.error.bundledUnavailable", { status: 0 }));
  })();
  bundledCache.set(packageId, loading);
  return loading;
}

/**
 * Hand the browser capabilities to `core/media`. Call once, before the editor
 * mounts: loading a skin can happen as early as the hit sounds.
 */
export function installNoteSkinBridge(): void {
  setBundledNoteSkinLoader(loadBundledSkin);
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
    ...BUILTIN_NOTE_SKIN_PACKAGE_IDS.map(builtinNoteSkinSelectionId),
    ...externalNoteSkins().map((skin) => `${EXTERNAL_NOTE_SKIN_PREFIX}${skin.id}`),
  ]);
  setNoteSkinChangeNotifier(() => {
    bundledCache.clear();
    bundledNameCache = null;
    window.dispatchEvent(new Event(NOTE_SKIN_EVENT));
  });
}
