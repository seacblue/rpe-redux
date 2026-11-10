/**
 * Note-skin packages stored in the browser library database.
 *
 * Skins travel with themes, Extensions, preferences, and the chart library in
 * one SQLite file, so a browser export and a library backup carry them together.
 */
import { isPackageName, type PackageName } from "../../utils/packageName.ts";
import { t } from "../../../i18n/index.ts";
import type {
  ExternalNoteSkinPackage,
  ExternalNoteSkinSummary,
} from "../desktop/noteSkinPackages.ts";
import { openBrowserLibrary } from "./library/browserLibrary.ts";

const PACKAGE_KIND = "skin";

/**
 * The shipped package's writable id.
 *
 * The built-in package's display name is "Built-in - Original"; the shared slug
 * rule makes this the folder id on both hosts. A saved built-in edit lives under
 * the same id so the runtime can shadow the compiled copy.
 */
export const BUILTIN_NOTE_SKIN_PACKAGE_ID = "built_in_original";

/** Mix one 32-bit value into the package fingerprint. */
function mix(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

/** A small stable signature; it only has to change when package bytes change. */
function fingerprint(files: ReadonlyMap<string, Uint8Array>): string {
  let hash = 0x811c9dc5;
  for (const name of [...files.keys()].sort()) {
    const bytes = files.get(name);
    if (!bytes) {
      continue;
    }
    hash = mix(hash, name.length);
    for (let index = 0; index < name.length; index++) {
      hash = mix(hash, name.charCodeAt(index));
    }
    hash = mix(hash, bytes.byteLength);
    for (const byte of bytes) {
      hash = mix(hash, byte);
    }
  }
  return hash.toString(16).padStart(8, "0");
}

/** Decode a stored package name; fall back to the raw text when it is damaged. */
function readName(text: string): PackageName {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPackageName(parsed)) {
      return parsed;
    }
  } catch {
    // Older rows may hold a plain display name.
  }
  return text;
}

/** Open the shared browser library, translating a storage failure. */
async function library() {
  try {
    return await openBrowserLibrary();
  } catch {
    throw new Error(t("settings.skin.error.browserStorage"));
  }
}

/** List every installed web skin, including a possible built-in override. */
export async function listBrowserNoteSkins(): Promise<ExternalNoteSkinSummary[]> {
  try {
    const store = await library();
    const packages = await store.appPackageList(PACKAGE_KIND);
    return packages.map((entry) => ({
      id: entry.id,
      name: readName(entry.name),
      source: "portable",
      builtin: entry.id === BUILTIN_NOTE_SKIN_PACKAGE_ID,
      fingerprint: entry.fingerprint,
    }));
  } catch {
    return [];
  }
}

/** Read one installed web skin, or throw when the id is unknown. */
export async function readBrowserNoteSkin(id: string): Promise<ExternalNoteSkinPackage> {
  const store = await library();
  const record = await store.appPackageRead(PACKAGE_KIND, id);
  return {
    files: new Map(record.files.map(({ name, bytes }) => [name, bytes])),
    source: "portable",
  };
}

/** Store one validated skin under its writable id. */
export async function installBrowserNoteSkin(
  id: string,
  name: PackageName,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const store = await library();
  await store.appPackageInstall(
    PACKAGE_KIND,
    id,
    JSON.stringify(name),
    fingerprint(files),
    [...files].map(([fileName, bytes]) => ({ name: fileName, bytes })),
  );
}

/** Remove one installed web skin; an unknown id is already absent. */
export async function removeBrowserNoteSkin(id: string): Promise<void> {
  const store = await library();
  await store.appPackageRemove(PACKAGE_KIND, id);
}
