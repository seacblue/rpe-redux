/**
 * JSON transport for the local Go + SQLite service.
 *
 * This module owns request scheduling, timeouts, response decoding, and the
 * stable `LocalLibraryError` envelope. The `LocalLibrary` class in `client.ts`
 * owns endpoint shapes; business callers keep importing that class.
 */
import { t } from "../../../i18n/index.ts";
import type { FailureSource } from "../../contracts/failure.ts";
import { beginBackendTrace } from "../../diagnostics/backendTrace.ts";
import { scheduleServiceRequest } from "./requestQueue.ts";

/** Per-request transport options. */
export interface RequestOptions {
  timeoutMs?: number;
  /** Extra headers, such as the preference-write credential. */
  headers?: Record<string, string>;
}

/** One JSON request before scheduling. */
export interface RequestInput extends RequestOptions {
  method?: string;
  body?: unknown;
  /** Pre-serialized JSON. Used when the chart text must not be marshaled twice. */
  bodyText?: string;
}

/** A failed service request, carrying its HTTP status and service error code. */
export class LocalLibraryError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly source: FailureSource;
  readonly retryable?: boolean;

  /**
   * Build the error.
   *
   * `status` is 0 when the request never reached the service; `details` carries
   * the service's structured error payload when one was returned.
   */
  constructor(
    message: string,
    {
      status = 0,
      code = "transport",
      details,
      source = "backend",
      retryable,
    }: {
      status?: number;
      code?: string;
      details?: unknown;
      source?: FailureSource;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "LocalLibraryError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.source = source;
    this.retryable = retryable;
  }
}

interface ServiceErrorPayload {
  message?: string;
  code?: string;
  details?: unknown;
  source?: FailureSource;
  retryable?: boolean;
}

/** Decode one failed service response into the shared local-library envelope. */
export async function libraryErrorFromResponse(
  response: Response,
  fallbackCode = "http_error",
): Promise<LocalLibraryError> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
      status: response.status,
      code: "bad_response",
    });
  }
  let payload: { error?: ServiceErrorPayload } & Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return new LocalLibraryError(t("system.library.nonJsonResponse", { status: response.status }), {
      status: response.status,
      code: "bad_response",
    });
  }
  const error = payload.error;
  const code = error?.code ?? fallbackCode;
  return new LocalLibraryError(
    code === "storage_error"
      ? t("system.library.storageError")
      : (error?.message ?? t("system.library.requestFailed", { status: response.status })),
    {
      status: response.status,
      code,
      details: error?.details,
      source: error?.source,
      retryable: error?.retryable,
    },
  );
}

/**
 * Send one JSON request and normalize transport, HTTP and decode failures into
 * `LocalLibraryError`.
 */
async function performRequest<T>(
  origin: string,
  path: string,
  { method = "GET", body, bodyText, timeoutMs = 4000, headers = {} }: RequestInput = {},
): Promise<T> {
  const trace = beginBackendTrace(method, path);
  const signal =
    typeof globalThis.AbortSignal?.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  const requestBody = bodyText ?? (body === undefined ? undefined : JSON.stringify(body));
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      signal,
      headers: {
        ...(method === "GET" || method === "HEAD" ? {} : { "x-redux-client": "1" }),
        ...(requestBody === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: requestBody,
    });
  } catch (error) {
    trace.finish({ status: null, outcome: "error", errorCode: "transport" });
    throw new LocalLibraryError(
      t("system.library.unreachable", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    trace.finish({ status: response.status, outcome: "error", errorCode: "bad_response" });
    throw new LocalLibraryError(t("system.library.requestFailed", { status: response.status }), {
      status: response.status,
      code: "bad_response",
    });
  }
  let payload: {
    error?: ServiceErrorPayload;
  } & Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    trace.finish({ status: response.status, outcome: "error", errorCode: "bad_response" });
    throw new LocalLibraryError(t("system.library.nonJsonResponse", { status: response.status }), {
      status: response.status,
      code: "bad_response",
    });
  }
  if (!response.ok) {
    const code = payload?.error?.code ?? "http_error";
    trace.finish({
      status: response.status,
      outcome: "error",
      errorCode: code,
    });
    throw new LocalLibraryError(
      code === "storage_error"
        ? t("system.library.storageError")
        : (payload?.error?.message ??
            t("system.library.requestFailed", { status: response.status })),
      {
        status: response.status,
        code,
        details: payload?.error?.details,
        source: payload?.error?.source,
        retryable: payload?.error?.retryable,
      },
    );
  }
  trace.finish({ status: response.status, outcome: "success" });
  return payload as T;
}

/**
 * Queue one service request.
 *
 * The queue bounds concurrent loopback calls and gives mutations priority over
 * background listings; the per-request timeout starts only when the task runs,
 * so time spent waiting for a slot does not shorten the HTTP deadline.
 */
export function request<T>(origin: string, path: string, input: RequestInput = {}): Promise<T> {
  return scheduleServiceRequest(input.method ?? "GET", () =>
    performRequest<T>(origin, path, input),
  );
}
