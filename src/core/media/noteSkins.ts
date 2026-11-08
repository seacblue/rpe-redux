/**
 * The active note skin and its loading lifecycle.
 *
 * Bundled-skin resolution and change notification arrive through installed hooks,
 * so this core module never imports a bundler glob or the DOM.
 */
import type { NoteSkinManifest } from "./noteSkin.ts";
import {
  missingPhiraWorkbenchSlots,
  mergePhiraWorkbenchFallback,
  phiraWorkbenchAssetFromPack,
  phiraWorkbenchDraftFromPack,
  type PhiraWorkbenchSlot,
} from "./phiraSkinDraft.ts";
import { localService } from "../global/library/service.ts";
import {
  PREFERENCE_SECTIONS,
  preferences,
  readPreference,
  writePreference,
} from "../state/preferences.ts";

/**
 * Note skins: what one is, which one is active, and how it is loaded.
 *
 * The layer direction is the point of this module. A skin is chart-adjacent data
 * — the preview and the hit sounds both read it — so the domain lives in core.
 * Two things about it are *not* domain: resolving the skin bundled with the
 * build (a bundler and `document` concern), and announcing the change as a DOM
 * event. Those arrive through the two hooks below, which
 * `frontend/platform/noteSkinBridge.ts` installs at boot, so this file never
 * imports `@tauri-apps`, a bundler glob, or `document`.
 */

/** Supplies the skin compiled into the build. */
export type BundledNoteSkinLoader = () => Promise<LoadedNoteSkin>;

/** Supplies a skin package discovered beside the executable. */
export type ExternalNoteSkinLoader = (id: string) => Promise<LoadedNoteSkin>;

let bundledLoader: BundledNoteSkinLoader | null = null;
let externalLoader: ExternalNoteSkinLoader | null = null;
let skinChanged: (() => void) | null = null;

/** Supplies the ordered ids the runtime uses to fill missing skin slots. */
export type NoteSkinFallbackSources = () => readonly string[];

let fallbackSources: NoteSkinFallbackSources | null = null;

/** Install the ordered fallback source list, or null to keep the built-in only. */
export function setNoteSkinFallbackSources(provider: NoteSkinFallbackSources | null): void {
  fallbackSources = provider;
}

/** Install the loader that resolves the bundled skin, or null to clear it. */
export function setBundledNoteSkinLoader(loader: BundledNoteSkinLoader | null): void {
  bundledLoader = loader;
}

/** Install the loader that resolves an external skin by id, or null to clear it. */
export function setExternalNoteSkinLoader(loader: ExternalNoteSkinLoader | null): void {
  externalLoader = loader;
}

/** Called after the active skin is written, so the host can announce it. */
export function setNoteSkinChangeNotifier(notify: (() => void) | null): void {
  skinChanged = notify;
}

/**
 * Announce a content change to the active skin.
 *
 * Selecting a different package already writes the preference and announces
 * itself. An external package can instead replace its bitmaps on disk while
 * keeping the same id, so the host has to announce that case too.
 */
export function notifyNoteSkinChanged(): void {
  skinChanged?.();
}

/** A loaded skin and the preview textures the picker can show. */
export interface NoteSkinReady {
  id: string;
  previews: { name: string; url: string }[];
}
/** A parsed skin package: manifest plus its file bytes. */
export interface LoadedNoteSkin {
  id: string;
  /** Stable package folder id; the same id a save writes to. */
  packageId?: string;
  /** Where the bytes came from: the writable library, the shipped resources, or the build. */
  source?: NoteSkinPackageSource;
  manifest: NoteSkinManifest;
  files: Map<string, Uint8Array>;
}

/**
 * Provenance of a loaded package.
 *
 * `portable` is the writable library beside the executable, which can shadow a
 * shipped package with the same id; `resource` is the packaged resource root;
 * `compiled` is the asset bundle served by a web build.
 */
export type NoteSkinPackageSource = "portable" | "resource" | "compiled";

/** Id of the skin compiled into the build. */
export const DEFAULT_NOTE_SKIN = "builtin:default";
/** Prefix for skins discovered beside the executable. */
export const EXTERNAL_NOTE_SKIN_PREFIX = "external:";

/** The selected skin id, normalized to a selectable package. */
export const activeNoteSkin = () => {
  const selected = readPreference<string>(PREFERENCE_SECTIONS.noteSkin, DEFAULT_NOTE_SKIN);
  // Compatibility ids `rpe` and `external:default` both name the bundled default.
  if (selected === "rpe" || selected === "external:default") {
    return DEFAULT_NOTE_SKIN;
  }
  // Any other id reads as the default skin.
  return selected === DEFAULT_NOTE_SKIN || selected.startsWith(EXTERNAL_NOTE_SKIN_PREFIX)
    ? selected
    : DEFAULT_NOTE_SKIN;
};

/**
 * Select a skin and persist it through the preference store.
 *
 * The live choice is committed synchronously; a changed value notifies the host
 * unless the load failed and restored the previous id.
 */
export async function selectNoteSkin(id: string) {
  // Commit the live choice synchronously: late connection results cannot reorder selections.
  const previous = readPreference<string>(PREFERENCE_SECTIONS.noteSkin, DEFAULT_NOTE_SKIN);
  writePreference(PREFERENCE_SECTIONS.noteSkin, id);
  // A failed load reverts to the last working id through this function; announcing
  // an unchanged value would make the renderer retry the load that just failed.
  if (previous !== id) {
    skinChanged?.();
  }
  if (!preferences.client) {
    const found = await localService({ refresh: true });
    if (found) {
      await preferences.attach(found.library);
    }
  }
  await preferences.ready();
  // Persist the active manifest-backed skin selection.
  return preferences.flush();
}
/**
 * Load a skin by id.
 *
 * External ids use the installed external loader; every other id loads the
 * bundled package. Throws when the required loader is not installed.
 */
export async function loadNoteSkin(id: string): Promise<LoadedNoteSkin> {
  if (id.startsWith(EXTERNAL_NOTE_SKIN_PREFIX)) {
    if (!externalLoader) {
      throw new Error(`Unsupported note skin: ${id}`);
    }
    return externalLoader(id.slice(EXTERNAL_NOTE_SKIN_PREFIX.length));
  }
  if (!bundledLoader) {
    throw new Error(`Unsupported note skin: ${id}`);
  }
  // The bundled package is the only built-in skin; any non-external id loads it.
  return bundledLoader();
}

/** Load one active pack and fill its missing slots from the ordered sources. */
export async function loadNoteSkinWithFallback(id: string): Promise<LoadedNoteSkin> {
  const active = await loadNoteSkin(id);
  const missing = missingPhiraWorkbenchSlots(phiraWorkbenchDraftFromPack(active));
  if (!missing.length) {
    return active;
  }
  const { sources } = await fallbackSourcePacks(id, missing);
  return mergePhiraWorkbenchFallback(active, sources);
}

/** Slots no installed skin can provide for the selected pack. */
export async function unresolvedNoteSkinSlots(id: string): Promise<PhiraWorkbenchSlot[]> {
  const active = await loadNoteSkin(id);
  const missing = missingPhiraWorkbenchSlots(phiraWorkbenchDraftFromPack(active));
  if (!missing.length) {
    return [];
  }
  const { remaining } = await fallbackSourcePacks(id, missing);
  return [...remaining];
}

/**
 * Load fallback sources in preference order until every requested slot is
 * covered. Loading stops early so a normal incomplete skin usually reads only
 * the built-in pack.
 */
async function fallbackSourcePacks(
  activeId: string,
  slots: readonly PhiraWorkbenchSlot[],
): Promise<{
  sources: LoadedNoteSkin[];
  remaining: Set<PhiraWorkbenchSlot>;
}> {
  const remaining = new Set(slots);
  const sources: LoadedNoteSkin[] = [];
  const sourceIds = fallbackSources ? fallbackSources() : [DEFAULT_NOTE_SKIN];
  for (const sourceId of sourceIds) {
    if (!remaining.size) {
      break;
    }
    if (sourceId === activeId) {
      continue;
    }
    try {
      const source = await loadNoteSkin(sourceId);
      sources.push(source);
      for (const slot of [...remaining]) {
        if (phiraWorkbenchAssetFromPack(source, slot)) {
          remaining.delete(slot);
        }
      }
    } catch {
      // A broken source cannot cover a slot; the next candidate still can.
    }
  }
  return { sources, remaining };
}
