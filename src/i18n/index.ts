/**
 * `t()` and the current language.
 *
 * The language is process state, not React state, because half of this app is
 * not React: the imperative editor builds its own DOM and has to render its own
 * text. React reads the same state through `useSyncExternalStore` in `react.ts`,
 * so a language change repaints the React shell live and notifies the editor
 * through the same subscription.
 *
 * Nothing here imports another layer, which is what lets `model/` use it for
 * format errors and `design/` use it for its own aria labels.
 */
import { CATALOGS, en, type MessageKey } from "./messages/index.ts";
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  HTML_LANG,
  isLanguage,
  LANGUAGE_NAMES,
  LANGUAGES,
  normalizeLanguage,
  type Language,
} from "./locale.ts";
import { interpolate, type Catalog, type MessageParams } from "./types.ts";

export { LANGUAGES, LANGUAGE_NAMES, DEFAULT_LANGUAGE, detectLanguage, normalizeLanguage };
export type { Language, MessageParams };
export type { MessageKey };

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<(language: Language) => void>();
/** Catalogs contributed by external packages, keyed by owner and read by `tRaw`. */
const externalCatalogs = new Map<string, Partial<Record<Language, Catalog>>>();

/** The language the interface is currently speaking. */
export function getLanguage(): Language {
  return current;
}

/**
 * Subscribes to language changes; returns the unsubscribe function.
 *
 * The listener runs once immediately so a subscriber never has to duplicate the
 * "apply the current value" call before registering.
 */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/**
 * Switches language and reapplies everything derived from it.
 *
 * The `lang` attribute is written here rather than by a component: it belongs to
 * the document, and the imperative editor renders text without a React tree.
 */
export function setLanguage(value: unknown): Language {
  const next = normalizeLanguage(value) ?? (isLanguage(value) ? value : DEFAULT_LANGUAGE);
  if (next === current) {
    return current;
  }
  current = next;
  applyDocumentLanguage();
  for (const listener of [...listeners]) {
    listener(current);
  }
  return current;
}

/** Writes the language onto `<html lang>`, which drives fonts and hyphenation. */
export function applyDocumentLanguage(): void {
  const root = globalThis.document?.documentElement;
  if (root) {
    root.lang = HTML_LANG[current];
    root.dataset.language = current;
  }
}

/**
 * The text for `key` in the current language.
 *
 * A key missing from the current catalog falls back to English, and a key
 * missing from both renders as the key itself, so a dynamic key degrades
 * visibly without throwing.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const text = CATALOGS[current][key] ?? (en as Catalog)[key];
  if (text === undefined) {
    return String(key);
  }
  return interpolate(text, params);
}

/**
 * `t()` for a key assembled at runtime (an id from a table, a loop variable).
 *
 * Kept separate and rare: it is the one entry point that gives up the
 * compile-time guarantee. Callers must keep dynamic keys aligned with the catalog.
 */
export function tRaw(key: string, params?: MessageParams): string {
  const external = [...externalCatalogs.values()]
    .map((catalogs) => catalogs[current]?.[key] ?? catalogs.en?.[key])
    .find((value): value is string => value !== undefined);
  const text = external ?? CATALOGS[current][key] ?? (en as Catalog)[key];
  if (text === undefined) {
    return key;
  }
  return interpolate(text, params);
}

/**
 * Register the core namespaces that the editor shell owns.
 *
 * The startup graph only carries the chrome/startup text. The shell imports the
 * remaining catalogs and registers them before it renders, so a deferred key
 * never reaches a visible surface as a raw id.
 */
export function registerCoreCatalog(catalogs: Partial<Record<Language, Catalog>>): void {
  for (const language of LANGUAGES) {
    const catalog = catalogs[language];
    if (catalog) {
      Object.assign(CATALOGS[language], catalog);
    }
  }
}

/**
 * Register a namespaced catalog supplied by an external package.
 *
 * This is intentionally an internal seam: callers must pass the fully
 * namespaced `extension::owner::key` form produced by the extension adapter.
 */
export function registerExternalCatalog(
  owner: string,
  catalogs: Partial<Record<Language, Catalog>>,
): () => void {
  for (const catalog of Object.values(catalogs)) {
    for (const key of Object.keys(catalog ?? {})) {
      if (!key.startsWith("extension::")) {
        throw new Error(`External catalog key must start with "extension::": ${key}`);
      }
    }
  }
  externalCatalogs.set(owner, catalogs);
  return () => {
    if (externalCatalogs.get(owner) === catalogs) {
      externalCatalogs.delete(owner);
    }
  };
}

/**
 * Picks `<base>.one` or `<base>.other` for `count`.
 *
 * Both suffixes exist in every language even when the translation does not
 * inflect, so the parity check stays a plain key comparison and a translator
 * adding a language with plurals needs no new mechanism.
 */
export function plural(base: string, count: number, params?: MessageParams): string {
  const suffix = count === 1 ? "one" : "other";
  return tRaw(`${base}.${suffix}`, { count, ...params });
}

/** True when `key` is declared by the English catalog. */
export function hasMessage(key: string): boolean {
  return Object.hasOwn(en, key);
}
