/**
 * The Extension capability vocabulary and its runtime error.
 *
 * A manifest declaration is a request; the runtime grants only the names in
 * this list and every host entry point checks the grant before it delegates.
 * Keeping the vocabulary here keeps the manifest validator, the capability
 * gate, and the SDK on one spelling.
 */

/** Every capability a sandboxed Extension may declare in this host major. */
export const EXTENSION_CAPABILITIES = Object.freeze([
  "scripts",
  "chart.read",
  "chart.write",
  "selection.read",
  "selection.write",
  "document.read",
  "document.write",
  "library.read",
  "library.write",
  "assets.write",
  "playback.read",
  "playback.control",
  "ui.notice",
  "ui.dialog",
  "ui.panel",
  "ui.sidebar",
  "ui.overlay",
  "ui.toolbar",
  "ui.guide",
  "ui.contextMenu",
  "shortcuts",
  /** Read host shortcut bindings through `api.toolbar.bindings`/`shortcutText`. */
  "shortcuts.read",
  "settings",
  "hooks",
  "values",
  "storage",
  "events",
  "services",
  "styles",
  "timers",
  "diagnostics",
  "hitTest.read",
  "preview.read",
  /**
   * @deprecated Host-only gate name kept for installed manifests. It grants no
   * handle and produces no positive check; the next major may remove it.
   */
  "host.patch",
] as const);

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(EXTENSION_CAPABILITIES);

/** Whether a manifest string names a capability the host can grant. */
export function isExtensionCapability(value: unknown): value is ExtensionCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

/**
 * Normalize a manifest declaration without inventing grants.
 *
 * Missing declarations grant nothing. Duplicates are removed; unknown names
 * are reported to the caller by `validateManifest` rather than silently kept.
 */
export function normalizeCapabilities(
  values: readonly unknown[] | undefined,
): readonly ExtensionCapability[] {
  if (!Array.isArray(values)) {
    return Object.freeze([]);
  }
  const seen = new Set<ExtensionCapability>();
  for (const value of values) {
    if (isExtensionCapability(value)) {
      seen.add(value);
    }
  }
  return Object.freeze([...seen]);
}

/**
 * Extension actions live under a host-owned prefix.
 *
 * The package sees a short local id; the toolbar, values, and persisted shortcut
 * keys see the stable owner-qualified id. Reserving `extension.` and the legacy
 * `mod.` spelling prevents a package from claiming a built-in or another owner's
 * namespace even if it guesses the prefix.
 */
export function extensionActionId(owner: string, localId: string): string {
  const id = localId.trim();
  if (!id) {
    throw new Error("Extension action id must be non-empty");
  }
  if (id.startsWith("extension.") || id.startsWith("mod.")) {
    throw new Error(`Extension action id must be local: ${localId}`);
  }
  return `extension.${owner}.${id}`;
}

/** The stable error code carried by a capability denial. */
export type CapabilityDeniedCode = "capabilityDenied";

/** Thrown when a package reaches a host entry point it did not declare. */
export class ExtensionCapabilityError extends Error {
  readonly code: CapabilityDeniedCode = "capabilityDenied";
  readonly capability: ExtensionCapability;

  /** Build the denial for one capability and the action that requested it. */
  constructor(capability: ExtensionCapability, action: string) {
    super(`Extension capability is not granted: ${capability} (${action})`);
    this.name = "ExtensionCapabilityError";
    this.capability = capability;
  }
}

/** Resolve one grant or fail with a stable, structured error. */
export function requireExtensionCapability(
  granted: ReadonlySet<ExtensionCapability>,
  capability: ExtensionCapability,
  action: string,
): void {
  if (!granted.has(capability)) {
    throw new ExtensionCapabilityError(capability, action);
  }
}
