/**
 * Discovery identity and persisted removal markers for packaged Extensions.
 *
 * The loader compares the raw manifest and i18n bytes the host rediscovered,
 * never a materialised manifest, so translations injected by the loader cannot
 * look like a content change. Removal markers keep an explicit removal of a
 * folder-backed package hidden across discovery polls without deleting files.
 */
import { PREFERENCE_SECTIONS, type PreferenceStore } from "../../core/state/preferences.ts";
import { isRecord } from "../../core/utils/guards.ts";

const REMOVED_KEY = "extension:removed";

/** Marker identity that hides any content for one package id. */
export const ANY_PACKAGE_CONTENT = "*";

/** One package the user removed from the loaded Extension list. */
export interface RemovedExtensionMark {
  readonly id: string;
  readonly identity: string;
  readonly removedAt: number;
}

/** Deterministic JSON text for one discovered package's raw content. */
export function packageContentIdentity(
  manifest: unknown,
  i18n: unknown,
  assetsDigest?: string,
): string {
  return assetsDigest === undefined
    ? stableText([manifest ?? null, i18n ?? null])
    : stableText([manifest ?? null, i18n ?? null, assetsDigest]);
}

/** Stable JSON with object keys sorted, so property order is not content. */
function stableText(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableText).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableText(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Content identities recorded when packages were registered.
 *
 * A missing entry means the loader cannot prove the bytes are unchanged, so the
 * package is re-read; that is the conservative answer for an unknown identity.
 */
export class ExtensionContentIndex {
  private readonly identities = new Map<string, string>();

  /** Record the bytes that were registered for one package. */
  remember(extensionId: string, identity: string): void {
    this.identities.set(extensionId, identity);
  }

  /** Drop one record after its package was unloaded or removed. */
  forget(extensionId: string): void {
    this.identities.delete(extensionId);
  }

  /** The identity recorded for one package, when it is still known. */
  identityOf(extensionId: string): string | undefined {
    return this.identities.get(extensionId);
  }

  /** Whether discovered bytes match the registered bytes; null when unknown. */
  matches(extensionId: string, identity: string): boolean | null {
    const known = this.identities.get(extensionId);
    return known === undefined ? null : known === identity;
  }

  /** Whether a discovered package must be re-registered. */
  needsReload(extensionId: string, identity: string, force = false): boolean {
    return force || this.matches(extensionId, identity) !== true;
  }

  /**
   * Decide one discovery pass for a package.
   *
   * A loaded package is re-read only when it is user-managed, refresh is
   * scanning existing records, and its bytes changed or a force was requested.
   * An absent package is skipped while its removal marker matches.
   */
  reconcile(
    extensionId: string,
    identity: string,
    state: {
      existing: boolean;
      userManaged: boolean;
      skipExisting: boolean;
      force?: boolean;
      removed?: boolean;
    },
  ): "skip" | "register" | "reload" {
    if (!state.existing) {
      return state.removed ? "skip" : "register";
    }
    if (!state.userManaged || !state.skipExisting) {
      return "skip";
    }
    return this.needsReload(extensionId, identity, state.force === true) ? "reload" : "skip";
  }
}

/** Current removal markers, keyed by package id. */
export function readExtensionRemovals(store: PreferenceStore): RemovedExtensionMark[] {
  const section = store.read<unknown>(PREFERENCE_SECTIONS.settings, null);
  const marks = isRecord(section) ? section[REMOVED_KEY] : undefined;
  if (!Array.isArray(marks)) {
    return [];
  }
  const byId = new Map<string, RemovedExtensionMark>();
  for (const mark of marks) {
    if (
      isRecord(mark) &&
      typeof mark.id === "string" &&
      typeof mark.identity === "string" &&
      typeof mark.removedAt === "number"
    ) {
      byId.set(mark.id, {
        id: mark.id,
        identity: mark.identity,
        removedAt: mark.removedAt,
      });
    }
  }
  return [...byId.values()];
}

/** Whether one package id was removed for exactly these bytes. */
export function isExtensionRemoved(
  store: PreferenceStore,
  extensionId: string,
  identity: string,
): boolean {
  const mark = readExtensionRemovals(store).find((entry) => entry.id === extensionId);
  return (
    mark !== undefined && (mark.identity === ANY_PACKAGE_CONTENT || mark.identity === identity)
  );
}

/** Persist one removal so later discovery passes keep the package hidden. */
export function markExtensionRemoved(
  store: PreferenceStore,
  extensionId: string,
  identity: string,
  at = Date.now(),
): void {
  const next = readExtensionRemovals(store).filter((mark) => mark.id !== extensionId);
  next.push({ id: extensionId, identity, removedAt: at });
  writeRemovals(store, next);
}

/** Drop one package's removal marker, for example when it is reinstalled. */
export function clearExtensionRemoved(store: PreferenceStore, extensionId: string): void {
  const marks = readExtensionRemovals(store);
  const next = marks.filter((mark) => mark.id !== extensionId);
  if (next.length !== marks.length) {
    writeRemovals(store, next);
  }
}

/**
 * Drop a marker that belongs to older bytes; changed content becomes visible
 * again without requiring the user to find and edit preferences.
 */
export function clearStaleExtensionRemoved(
  store: PreferenceStore,
  extensionId: string,
  identity: string,
): void {
  const mark = readExtensionRemovals(store).find((entry) => entry.id === extensionId);
  if (mark !== undefined && mark.identity !== ANY_PACKAGE_CONTENT && mark.identity !== identity) {
    clearExtensionRemoved(store, extensionId);
  }
}

/** Write the whole marker list while preserving the rest of the section. */
function writeRemovals(store: PreferenceStore, marks: readonly RemovedExtensionMark[]): void {
  const section = store.read<unknown>(PREFERENCE_SECTIONS.settings, null);
  const next = { ...(isRecord(section) ? section : {}) };
  if (marks.length === 0) {
    delete next[REMOVED_KEY];
  } else {
    next[REMOVED_KEY] = marks.map((mark) => ({ ...mark }));
  }
  store.write(PREFERENCE_SECTIONS.settings, next);
}
