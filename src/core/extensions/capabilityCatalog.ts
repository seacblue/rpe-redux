/**
 * The catalog for every Extension capability name.
 *
 * One row per capability supplies the risk tier, the i18n key pair, and up to
 * five host-visible method examples taken from the method registry. The
 * install dialog, documentation, and contract checks read this table so they
 * cannot drift from the runtime vocabulary. The deprecated `host.patch` row is
 * catalog-only: it grants nothing and never reaches the consent dialog.
 *
 * The label and description keys stay plain strings in this layer; the i18n
 * catalog owns their registration, and narrowing them to `MessageKey` here
 * would make an unregistered key a compile error before the integration lands.
 */
import { EXTENSION_CAPABILITIES, type ExtensionCapability } from "./capabilities.ts";
import { methodKey, methodsForCapability, type ExtensionMethodRisk } from "./methodRegistry.ts";

/** Maximum number of method examples shown for one capability. */
const MAX_EXAMPLES = 5;

/** i18n key for one capability's consent label. */
export type CapabilityConsentLabelKey = `settings.extensions.capability.${string}.label`;

/** i18n key for one capability's consent description. */
export type CapabilityConsentDescriptionKey =
  `settings.extensions.capability.${string}.description`;

/** Localized, human-facing description of one capability request. */
export interface CapabilityConsentRow {
  /** Capability the manifest declares. */
  readonly capability: ExtensionCapability;
  /** Highest risk tier the capability exposes. */
  readonly risk: ExtensionMethodRisk;
  /** i18n key under `settings.extensions.capability.*`. */
  readonly labelKey: CapabilityConsentLabelKey;
  /** i18n key under `settings.extensions.capability.*`. */
  readonly descriptionKey: CapabilityConsentDescriptionKey;
  /** Host-visible examples from the method registry, capped at five. */
  readonly examples: readonly string[];
}

/** Risk tier for every capability, including the deprecated host-only name. */
const CAPABILITY_RISK = Object.freeze({
  scripts: "write",
  "chart.read": "read",
  "chart.write": "write",
  "selection.read": "read",
  "selection.write": "write",
  "document.read": "read",
  "document.write": "sensitive",
  "library.read": "read",
  "library.write": "sensitive",
  "assets.write": "sensitive",
  "playback.read": "read",
  "playback.control": "write",
  "ui.notice": "write",
  "ui.dialog": "sensitive",
  "ui.guide": "sensitive",
  "ui.panel": "write",
  "ui.sidebar": "write",
  "ui.overlay": "write",
  "ui.toolbar": "write",
  "ui.contextMenu": "write",
  shortcuts: "write",
  /** Additive read-only access to host shortcut bindings; it registers no method. */
  "shortcuts.read": "read",
  settings: "write",
  hooks: "write",
  values: "write",
  storage: "write",
  events: "read",
  services: "write",
  styles: "write",
  timers: "write",
  diagnostics: "write",
  "hitTest.read": "read",
  "preview.read": "read",
  "host.patch": "sensitive",
} satisfies Record<ExtensionCapability, ExtensionMethodRisk>);

/** Build the consent label key for one capability. */
function labelKeyFor(capability: ExtensionCapability): CapabilityConsentLabelKey {
  return `settings.extensions.capability.${capability}.label`;
}

/** Build the consent description key for one capability. */
function descriptionKeyFor(capability: ExtensionCapability): CapabilityConsentDescriptionKey {
  return `settings.extensions.capability.${capability}.description`;
}

/** Collect the first five registered method keys for one capability. */
function examplesFor(capability: ExtensionCapability): readonly string[] {
  return Object.freeze(
    methodsForCapability(capability)
      .slice(0, MAX_EXAMPLES)
      .map((entry) => methodKey(entry.handle, entry.method)),
  );
}

/**
 * One catalog row per capability, including the deprecated host-only name.
 *
 * The catalog is the single source for consent labels, descriptions, risk
 * classification, and documentation. `CAPABILITY_CONSENT_ROWS` filters it to
 * the names an install dialog may show.
 */
export const CAPABILITY_CATALOG: readonly CapabilityConsentRow[] = Object.freeze(
  EXTENSION_CAPABILITIES.map((capability) =>
    Object.freeze({
      capability,
      risk: riskOf(capability),
      labelKey: labelKeyFor(capability),
      descriptionKey: descriptionKeyFor(capability),
      examples: examplesFor(capability),
    }),
  ),
);

/**
 * Consent rows for the install dialog: every grantable capability.
 *
 * `host.patch` is excluded because it grants no handle and is stripped before
 * consent; `riskOf` still answers for it so callers can classify legacy
 * manifests.
 */
export const CAPABILITY_CONSENT_ROWS: readonly CapabilityConsentRow[] = Object.freeze(
  CAPABILITY_CATALOG.filter((row) => row.capability !== "host.patch"),
);

/** The risk tier for one capability, including the deprecated host-only name. */
export function riskOf(capability: ExtensionCapability): ExtensionMethodRisk {
  return CAPABILITY_RISK[capability];
}

/**
 * Select the consent rows for one manifest declaration.
 *
 * Rows keep catalog order and are deduplicated; the deprecated `host.patch`
 * request has no consent row and therefore never reaches the consent dialog.
 */
export function consentRowsFor(
  capabilities: readonly ExtensionCapability[],
): readonly CapabilityConsentRow[] {
  const requested = new Set(capabilities);
  return Object.freeze(CAPABILITY_CONSENT_ROWS.filter((row) => requested.has(row.capability)));
}
