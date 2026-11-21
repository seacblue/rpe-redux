/**
 * The shared structured-result contract used by host APIs and editor services.
 *
 * Keeping the envelope outside `core/api/` lets editor internals describe the
 * same success/failure shape without depending on the public facade assembly.
 */
/** Stable failure categories shared by host APIs and editor services. */
export type ApiErrorCode =
  | "unavailable"
  | "invalid_request"
  | "unsupported"
  | "unchanged"
  | "rejected"
  | "conflict"
  | "stale_read"
  | "unsaved_changes"
  | "multiple_candidates"
  | "save_conflict"
  | "failed";

/** One failure reason with an optional message and issue list. */
export interface ApiError {
  code: ApiErrorCode;
  message?: string;
  issues?: readonly string[];
}

/** Success value or a structured error. */
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };
