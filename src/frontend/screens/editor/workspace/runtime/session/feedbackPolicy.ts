/**
 * Resolves normalized failures into editor copy and one primary presentation
 * intent while leaving ToastHost and modalQueue as rendering hosts.
 */
import { t } from "../../../../../../i18n/index.ts";
import {
  failureDedupeKey,
  normalizeFailure,
  type FailureContext,
  type FailurePresentationOwner,
  type NormalizedFailure,
} from "../../../../../../core/contracts/failure.ts";

/** Presentation host selected by the editor feedback policy. */
export type FeedbackSurface = "toast" | "inline" | "none";

/** Localized error copy and routing decision for one editor failure. */
export interface EditorFailurePresentation {
  failure: NormalizedFailure;
  message: string;
  detail: string;
  surface: FeedbackSurface;
  level: "warning" | "error";
  dedupeKey: string;
}

/** Returns a safe localized message for known backend and database codes. */
function messageFor(failure: NormalizedFailure): string {
  switch (failure.code) {
    case "storage_error":
      return t("system.library.storageError");
    case "revision_conflict":
      return t("workspace.document.error.libraryRevisionConflict");
    case "save_conflict":
      return t("workspace.document.error.saveConflict");
    case "not_found":
      return t("system.library.notFound");
    case "invalid_request":
    case "invalid_json":
    case "invalid_chart":
      return t("system.library.invalidRequest");
    case "transport":
    case "unavailable":
    case "not_ready":
      return t("system.library.unavailable");
    case "internal_error":
    case "browser_library_error":
    case "bad_response":
    case "http_error":
      return t("system.library.requestFailedGeneric");
    default:
      return failure.source === "backend" || failure.source === "database"
        ? t("system.library.requestFailedGeneric")
        : failure.message;
  }
}

/** Selects the one surface that owns user action for a normalized failure. */
function surfaceFor(failure: NormalizedFailure, owner?: FailurePresentationOwner): FeedbackSurface {
  if (owner === "inline") {
    return "inline";
  }
  if (failure.kind === "cancelled") {
    return "none";
  }
  return "toast";
}

/**
 * Resolve an unknown thrown value into localized editor feedback.
 *
 * `context` is the only knowledge callers need to add operation/resource identity
 * to dedupe; the backend and database codes remain inside this policy module.
 */
export function resolveEditorFailure(
  error: unknown,
  context: FailureContext = { operation: "editor.feedback" },
): EditorFailurePresentation {
  const failure = normalizeFailure(error, context);
  return {
    failure,
    message: messageFor(failure),
    detail: failure.message,
    surface: surfaceFor(failure, context.owner),
    level: failure.kind === "conflict" ? "warning" : "error",
    dedupeKey: failureDedupeKey(failure),
  };
}

/** A clock-driven short-window dedupe gate for repeated user feedback. */
export function createFeedbackDedupe(
  now: () => number = Date.now,
  windowMs = 1500,
): { claim(key: string): boolean } {
  const seen = new Map<string, number>();
  return {
    claim(key: string): boolean {
      const current = now();
      const previous = seen.get(key);
      seen.set(key, current);
      for (const [entry, timestamp] of seen) {
        if (current - timestamp > windowMs) {
          seen.delete(entry);
        }
      }
      return previous === undefined || current - previous > windowMs;
    },
  };
}
