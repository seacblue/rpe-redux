/**
 * Note-skin packages discovered beside the executable, and the writable library.
 *
 * This is a host concern: the desktop scanner returns folder summaries and
 * relative file bytes, the guarded installer writes a validated package into the
 * writable root, and removal deletes only that root. `core/media/noteSkin.ts`
 * remains the only parser and validator. The cache is updated by the shell's
 * folder poll so the picker reacts without a manual refresh.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../environment.ts";
import {
  activeNoteSkin,
  EXTERNAL_NOTE_SKIN_PREFIX,
  notifyNoteSkinChanged,
} from "../../media/noteSkins.ts";
import { isPackageName, packageSlug, type PackageName } from "../../utils/packageName.ts";
import { parseNoteSkin } from "../../media/noteSkin.ts";

/** A note-skin folder found on disk, as the picker lists it. */
export interface ExternalNoteSkinSummary {
  readonly id: string;
  readonly name: PackageName;
  readonly source: string;
  /** Whether the host designates this package as the built-in one. */
  readonly builtin: boolean;
  /** Host-computed content signature; changes when files on disk change. */
  readonly fingerprint: string;
}

let cached: readonly ExternalNoteSkinSummary[] = Object.freeze([]);
const listeners = new Set<() => void>();

/** Notify every listener after the cached folder set changes. */
function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Subscribe to external note-skin folder changes. */
export function subscribeExternalNoteSkins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The external note-skin folders found by the last scan. */
export function externalNoteSkins(): readonly ExternalNoteSkinSummary[] {
  return cached;
}

/** Re-scan the host skin roots; notify only when the folder set changed. */
export async function refreshExternalNoteSkins(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  let next: ExternalNoteSkinSummary[];
  try {
    next = await invoke<ExternalNoteSkinSummary[]>("list_note_skins");
  } catch {
    return;
  }
  const previous = new Map(cached.map((entry) => [entry.id, entry.fingerprint]));
  const before = JSON.stringify(cached);
  cached = Object.freeze(
    // The host marks the built-in package; the picker already offers it through
    // `DEFAULT_NOTE_SKIN`, so it must not be listed a second time here.
    next
      .filter((entry) => !entry.builtin)
      .map((entry) => ({
        id: String(entry.id ?? ""),
        name: isPackageName(entry.name) ? entry.name : String(entry.name ?? entry.id ?? ""),
        source: String(entry.source ?? "portable"),
        builtin: false,
        fingerprint: String(entry.fingerprint ?? ""),
      })),
  );
  if (JSON.stringify(cached) === before) {
    return;
  }
  notify();
  const active = activeNoteSkin();
  if (!active.startsWith(EXTERNAL_NOTE_SKIN_PREFIX)) {
    return;
  }
  const id = active.slice(EXTERNAL_NOTE_SKIN_PREFIX.length);
  const fingerprint = cached.find((entry) => entry.id === id)?.fingerprint;
  // The picker may only need a redraw, but the preview has to decode the new
  // bytes when the active package itself changed.
  if (previous.get(id) !== fingerprint) {
    notifyNoteSkinChanged();
  }
}

/** One package read from the host: its bytes and the root they came from. */
export interface ExternalNoteSkinPackage {
  readonly files: Map<string, Uint8Array>;
  /** Root the package lives in; `portable` is the writable user library. */
  readonly source: "portable" | "resource";
}

/** Read one skin package and decode its base64 file map for the shared parser. */
export async function readExternalNoteSkin(id: string): Promise<ExternalNoteSkinPackage> {
  const payload = await invoke<{
    files?: { name?: string; data?: string }[];
    source?: string;
  }>("read_note_skin", { id });
  const files = new Map<string, Uint8Array>();
  for (const entry of payload.files ?? []) {
    if (!entry.name || typeof entry.data !== "string") {
      continue;
    }
    const binary = atob(entry.data);
    files.set(
      entry.name,
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  }
  return { files, source: payload.source === "resource" ? "resource" : "portable" };
}

/** The package id the host designates as the built-in note skin. */
export async function builtinNoteSkinPackageId(): Promise<string> {
  return invoke<string>("builtin_note_skin_id");
}

/** Encode package bytes for the guarded native install command. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/**
 * Validate and install a Phira package into the writable skin library.
 *
 * Passing `id` overwrites that folder, which is how the workbench saves an
 * existing package: an edited built-in keeps the built-in package id, so the
 * writable copy shadows the shipped one instead of adding a picker entry. A
 * fresh import derives the id from the display name with the shared slug rule.
 * Returns the written id and the manifest name so the caller can label it.
 */
export async function installPhiraNoteSkin(
  files: ReadonlyMap<string, Uint8Array>,
  id?: string,
  options: { allowIncomplete?: boolean } = {},
): Promise<{ id: string; name: PackageName }> {
  const manifest = parseNoteSkin(files, options);
  const payload = [...files].map(([name, bytes]) => ({ name, data: base64(bytes) }));
  const targetId = id ?? packageSlug(manifest.name);
  await invoke<string>("install_note_skin", { id: targetId, files: payload });
  await refreshExternalNoteSkins();
  // The picker and the runtime cache both compare package ids; a same-id save
  // changes the bytes under an unchanged id, so announce it explicitly.
  notifyNoteSkinChanged();
  return { id: targetId, name: manifest.name };
}

/**
 * Remove one installed package from the writable skin library.
 *
 * Removing a built-in override restores the shipped package; the runtime then
 * re-reads the built-in id and announces the change.
 */
export async function removeInstalledNoteSkin(id: string): Promise<void> {
  await invoke<string>("remove_note_skin", { id });
  await refreshExternalNoteSkins();
  notifyNoteSkinChanged();
}
