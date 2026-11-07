/**
 * Startup failure classification and Extension candidate selection.
 *
 * The failure screen combines the error's origin with the Extension startup
 * evidence to choose one plain-language explanation and at most a short list of
 * packages to inspect. The rules are pure so the Node suite can pin the
 * user-visible branches without mounting React.
 */
import type {
  ExtensionStartupActivation,
  ExtensionStartupFailure,
} from "../../../core/extensions/extensionRuntimeSupport.ts";

/** Where the failure screen's diagnostic text came from. */
export type StartupFailureSource = "render" | "backend" | "editor" | "unknown";

/** The category that selects the plain-language explanation. */
export type StartupFailureCategory = "render" | "backend" | "extension" | "unknown";

/** One package row the failure screen can show. */
export type StartupExtensionEntry = ExtensionStartupFailure | ExtensionStartupActivation;

/** Most candidate packages the failure screen lists. */
export const STARTUP_EXTENSION_CANDIDATE_LIMIT = 8;

/** Longest failure line shown beside a package name. */
export const STARTUP_FAILURE_MESSAGE_LIMIT = 160;

/** The package rows a failure screen should render. */
export interface StartupExtensionCandidates {
  readonly kind: "failures" | "activations" | "none";
  readonly items: readonly StartupExtensionEntry[];
  readonly total: number;
}

/**
 * Pick the explanation category for a failure.
 *
 * A recorded Extension failure wins over the reported origin: the package error
 * is the actionable cause even when the visible crash happened later. The
 * editor provider tree counts as the interface because it owns the startup
 * render path.
 */
export function classifyStartupFailure(
  source: StartupFailureSource,
  failures: readonly ExtensionStartupFailure[],
): StartupFailureCategory {
  if (failures.length > 0) {
    return "extension";
  }
  if (source === "render" || source === "editor") {
    return "render";
  }
  if (source === "backend") {
    return "backend";
  }
  return "unknown";
}

/**
 * Choose the candidate block: explicit failures first, then packages that
 * loaded successfully, and an explicit empty state when there is no evidence.
 * Only the activation list is capped; the screen reports the omitted count.
 */
export function startupExtensionCandidates(
  failures: readonly ExtensionStartupFailure[],
  activations: readonly ExtensionStartupActivation[],
): StartupExtensionCandidates {
  if (failures.length > 0) {
    return { kind: "failures", items: failures, total: failures.length };
  }
  if (activations.length > 0) {
    return {
      kind: "activations",
      items: activations.slice(0, STARTUP_EXTENSION_CANDIDATE_LIMIT),
      total: activations.length,
    };
  }
  return { kind: "none", items: [], total: 0 };
}

/** Keep one failure line short and readable beside the package name. */
export function startupFailureMessage(message: string): string {
  const firstLine = message.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  return firstLine.length > STARTUP_FAILURE_MESSAGE_LIMIT
    ? `${firstLine.slice(0, STARTUP_FAILURE_MESSAGE_LIMIT - 1)}…`
    : firstLine;
}
