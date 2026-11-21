/**
 * Extension startup evidence shared by the failure screen and the loader.
 *
 * The failure screen must be able to explain an Extension-related startup
 * failure without importing the Extension loader, the sandbox runtime, or the
 * host API. The loader publishes its latest evidence here; the startup screen
 * reads it directly.
 */
import type {
  ExtensionStartupActivation,
  ExtensionStartupFailure,
} from "./extensionRuntimeSupport.ts";

/** Why the startup pass skipped Extension code. */
export type ExtensionSafeModeReason = "query" | "flag" | "request" | "interrupted" | null;

/** Startup verdict for the Extension pass and the evidence behind it. */
export interface ExtensionStartupState {
  readonly safeMode: boolean;
  readonly reason: ExtensionSafeModeReason;
  readonly failures: readonly ExtensionStartupFailure[];
  readonly activations: readonly ExtensionStartupActivation[];
}

const EMPTY: ExtensionStartupState = Object.freeze({
  safeMode: false,
  reason: null,
  failures: Object.freeze([]),
  activations: Object.freeze([]),
});

let current: ExtensionStartupState = EMPTY;

/** The latest published Extension startup evidence. */
export function getExtensionStartupState(): ExtensionStartupState {
  return current;
}

/** Replace the evidence after a startup, refresh, or safe-mode pass. */
export function setExtensionStartupState(next: ExtensionStartupState): void {
  current = next;
}
