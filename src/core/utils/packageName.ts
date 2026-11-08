/**
 * Display names supplied by skin and theme packages, and the folder id a
 * package derives from its own name.
 *
 * A package may ship one plain name, or one name per interface language. The
 * package owns those strings; the host only picks the current language, so a
 * built-in package never borrows a key from the application's message catalog.
 * The id rule is shared by every package kind so saving a package always writes
 * the same folder instead of minting a second one.
 */

export type PackageName = string | Readonly<Record<string, string>>;

const MAX_NAME = 200;

/** A non-empty trimmed string within the display-name length bound. */
function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME;
}

/** Accept a plain package name or a language-keyed name map with valid text. */
export function isPackageName(value: unknown): value is PackageName {
  if (validText(value)) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([language, text]) => language.length >= 2 && language.length <= 16 && validText(text),
    )
  );
}

/** Pick the current language, then English, then the first entry. */
export function packageName(name: PackageName, language: string): string {
  if (typeof name === "string") {
    return name;
  }
  return name[language] ?? name.en ?? Object.values(name)[0] ?? "";
}

/** Longest generated package id, in characters. */
const MAX_SLUG_LENGTH = 64;

/** FNV-1a over the UTF-8 bytes of one display name. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Derive a package folder id from a display name.
 *
 * The rule is universal: every package kind derives its writable folder from
 * its own name, so saving a package again writes the same folder instead of
 * minting a new one. English display names are the source of truth; letters and
 * digits survive, every other run collapses to `_`, and a name with no ASCII
 * characters falls back to a stable hash of the name. `built_in_original`
 * follows from the built-in package's own display name.
 */
export function packageSlug(name: PackageName): string {
  const english = packageName(name, "en");
  const slug = english
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/, "");
  return slug || `skin_${fnv1a(english).toString(16).padStart(8, "0")}`;
}
