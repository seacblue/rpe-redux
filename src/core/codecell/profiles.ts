/**
 * The capability profile a code cell may run under.
 *
 * A profile is the consent boundary for AI-authored code: the source changes on
 * every run, so the host grants a fixed, reviewable set of handles rather than
 * binding consent to package bytes. Both profiles can read the live preview
 * and render offscreen frames; the `write` profile can also apply chart
 * transactions and change assets of the library project behind the open
 * document, but cannot save, open, close, or delete documents. The capability
 * gate scopes every library handle to that one project.
 */
import type { ExtensionCapability } from "../extensions/capabilities.ts";
import type { CodeCellProfile } from "./contract.ts";

/** One profile id and the exact capabilities it grants. */
export interface CodeCellProfileDefinition {
  readonly id: CodeCellProfile;
  readonly capabilities: readonly ExtensionCapability[];
}

/** The read handles granted to the `read` profile. */
const READ_CAPABILITIES: readonly ExtensionCapability[] = Object.freeze([
  "document.read",
  "chart.read",
  "selection.read",
  "hitTest.read",
  "preview.read",
]);

/** The `write` profile keeps reads and adds atomic chart transactions. */
const WRITE_CAPABILITIES: readonly ExtensionCapability[] = Object.freeze([
  ...READ_CAPABILITIES,
  "chart.write",
  "library.read",
  "assets.write",
]);

/** Every profile the contract knows about, whether or not it is enabled. */
export const CODE_CELL_PROFILES: Readonly<Record<CodeCellProfile, CodeCellProfileDefinition>> =
  Object.freeze({
    read: Object.freeze({ id: "read", capabilities: READ_CAPABILITIES }),
    write: Object.freeze({ id: "write", capabilities: WRITE_CAPABILITIES }),
  });

/** Whether a string names a profile the runtime can resolve. */
export function isCodeCellProfile(value: unknown): value is CodeCellProfile {
  return value === "read" || value === "write";
}

/** The exact capabilities granted to one profile. */
export function codeCellCapabilities(profile: CodeCellProfile): readonly ExtensionCapability[] {
  return CODE_CELL_PROFILES[profile].capabilities;
}
