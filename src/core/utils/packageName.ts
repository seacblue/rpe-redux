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

/** Package ids are safe folder names shared by the browser and native hosts. */
export function isPackageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

/** FNV-1a over the UTF-8 bytes of one display name. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Convert a display name to its ASCII-only slug without the hash fallback. */
function asciiSlug(name: PackageName): string {
  return packageName(name, "en")
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/, "");
}

/**
 * Derive a package folder id from a display name.
 *
 * This is the legacy shared rule used by package kinds that do not declare a
 * separate id. English display names are the source of truth; letters and
 * digits survive, every other run collapses to `_`, and a name with no ASCII
 * characters falls back to a stable hash of the name.
 */
export function packageSlug(name: PackageName): string {
  const english = packageName(name, "en");
  const slug = asciiSlug(name);
  return slug || `skin_${fnv1a(english).toString(16).padStart(8, "0")}`;
}

/**
 * Derive a collision-resistant skin id from its display name.
 *
 * Unlike the legacy shared slug, note-skin ids retain the ASCII name stem and
 * append an eight-digit hash of the trimmed display name. This keeps two skins
 * with the same visible stem from sharing a writable package folder.
 */
export function packageSlugWithHash(name: PackageName): string {
  const english = packageName(name, "en").trim();
  const hash = fnv1a(english).toString(16).padStart(8, "0");
  const slug = asciiSlug(name);
  if (!slug) {
    return `skin_${hash}`;
  }
  const suffix = `_${hash}`;
  return `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/_+$/, "")}${suffix}`;
}
