/**
 * Owns the host-independent failure vocabulary shared by transport adapters and
 * frontend feedback policy without importing UI or platform implementations.
 */

/** Runtime boundary that produced a failure. */
export type FailureSource = "frontend" | "backend" | "database" | "native" | "unknown";

/** Stable user-facing family used to choose recovery and presentation policy. */
export type FailureKind =
  | "validation"
  | "conflict"
  | "storage"
  | "unavailable"
  | "not_found"
  | "corrupt"
  | "internal"
  | "cancelled"
  | "unknown";

/** Context supplied by the adapter that knows which operation failed. */
export interface FailureContext {
  source?: FailureSource;
  operation?: string;
  resource?: string;
  owner?: FailurePresentationOwner;
}

/** Presentation owner that has already surfaced a failure to the user. */
export type FailurePresentationOwner =
  "inline" | "progress" | "toast" | "modal" | "startup" | "diagnostic";

/** Normalized failure data; `message` is diagnostic input, not trusted UI copy. */
export interface NormalizedFailure {
  source: FailureSource;
  code: string;
  kind: FailureKind;
  retryable: boolean;
  message: string;
  operation?: string;
  resource?: string;
}

/** Reads a stable machine code from an error-like value. */
function readCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) {
      return code.trim();
    }
  }
  return undefined;
}

/** Reads the original message for diagnostics and unknown frontend failures. */
function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

/** Reads an explicit producer source when a transport adapter supplied one. */
function readSource(error: unknown): FailureSource | undefined {
  if (error && typeof error === "object" && "source" in error) {
    const source = (error as { source?: unknown }).source;
    if (
      source === "frontend" ||
      source === "backend" ||
      source === "database" ||
      source === "native" ||
      source === "unknown"
    ) {
      return source;
    }
  }
  return undefined;
}

/** Reads an adapter's retry hint when the transport knows more than the code. */
function readRetryable(error: unknown): boolean | undefined {
  if (error && typeof error === "object" && "retryable" in error) {
    const retryable = (error as { retryable?: unknown }).retryable;
    return typeof retryable === "boolean" ? retryable : undefined;
  }
  return undefined;
}

/** Chooses a failure family from a stable code without exposing UI concerns. */
function kindForCode(code: string): FailureKind {
  if (/^(?:abort|aborted|cancelled|canceled)$/i.test(code)) {
    return "cancelled";
  }
  if (/^(?:invalid|missing|unsupported|rejected|bad_request)/i.test(code)) {
    return "validation";
  }
  if (/conflict|revision/i.test(code)) {
    return "conflict";
  }
  if (/not[_-]?found|missing/i.test(code)) {
    return "not_found";
  }
  if (/storage|sqlite|database|disk|quota|permission|read[_-]?only|locked|busy/i.test(code)) {
    return "storage";
  }
  if (/transport|unavailable|offline|timeout|not[_-]?ready|unreachable/i.test(code)) {
    return "unavailable";
  }
  if (/corrupt|malformed|integrity/i.test(code)) {
    return "corrupt";
  }
  if (/internal|failed|error/i.test(code)) {
    return "internal";
  }
  return "unknown";
}

/** Whether the normalized family can succeed when the caller retries. */
function retryableFor(kind: FailureKind): boolean {
  return kind === "unavailable";
}

/**
 * Normalize one thrown value at a host seam.
 *
 * The returned `message` remains diagnostic data. Frontend callers must resolve
 * known codes to localized copy before displaying it.
 */
export function normalizeFailure(error: unknown, context: FailureContext = {}): NormalizedFailure {
  const message = readMessage(error);
  const code = readCode(error) ?? "unknown_error";
  const kind = kindForCode(code);
  const source =
    context.source ??
    readSource(error) ??
    (error instanceof Error && error.name === "LocalLibraryError" ? "backend" : "frontend");
  return {
    source,
    code,
    kind,
    retryable: readRetryable(error) ?? retryableFor(kind),
    message,
    ...(context.operation ? { operation: context.operation } : {}),
    ...(context.resource ? { resource: context.resource } : {}),
  };
}

/**
 * Build a stable key for presentation dedupe.
 *
 * Unknown failures include their message because there is no safer semantic code
 * to distinguish unrelated frontend failures.
 */
export function failureDedupeKey(failure: NormalizedFailure): string {
  const parts = [failure.source, failure.operation ?? "unknown-operation", failure.code];
  if (failure.resource) {
    parts.push(failure.resource);
  }
  if (failure.code === "unknown_error") {
    parts.push(failure.message);
  }
  return parts.join(":");
}

const presentationOwners = new WeakMap<object, FailurePresentationOwner>();

/** Marks an object failure as already rendered by a named presentation owner. */
export function markFailurePresented(error: unknown, owner: FailurePresentationOwner): void {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return;
  }
  presentationOwners.set(error as object, owner);
}

/** Returns the presentation owner that already handled an object failure. */
export function failurePresentationOwner(error: unknown): FailurePresentationOwner | undefined {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return undefined;
  }
  return presentationOwners.get(error as object);
}
