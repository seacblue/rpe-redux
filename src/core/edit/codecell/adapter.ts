/**
 * Adapts the mounted editor's code-cell runtime to the local HTTP bridge.
 *
 * The bridge accepts only the two Code Cell methods. Chart reads, transaction
 * writes, and capability checks stay inside the sandbox facade owned by
 * `core/codecell/`.
 */
import type { DocumentRevisions } from "../../contracts/revisions.ts";
import { revisionConflicts } from "../../contracts/revisions.ts";
import type {
  CodeCellErrorCode,
  CodeCellProfile,
  CodeCellRequest,
  CodeCellResult,
} from "../../codecell/contract.ts";
import { isCodeCellProfile } from "../../codecell/profiles.ts";
import {
  normalizePreviewFrameRequest,
  type PreviewFrameImage,
  type PreviewFrameSpec,
} from "../preview/frame.ts";
import { isRecord } from "../../utils/guards.ts";
import { getCodeCellGuide } from "./guide.ts";

export type CodeCellRevisions = DocumentRevisions;

export interface CodeCellDocumentState {
  readonly revisions: DocumentRevisions;
}

/** The mounted one-shot runner supplied by the active editor. */
export interface CodeCellHost {
  run(request: CodeCellRequest): Promise<CodeCellResult>;
}

export interface CodeCellAdapterOptions {
  readonly state: () => CodeCellDocumentState;
  /** Present only while the editor mount can run a code cell. */
  readonly code?: CodeCellHost;
  /** Present while the mounted editor can render chart frames. */
  readonly frame?: (request: PreviewFrameSpec) => Promise<PreviewFrameImage>;
  /** Rechecks the user's code-execution consent for direct frame requests. */
  readonly enabled?: () => boolean;
}

export interface CodeCellResponse<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: {
    readonly code: string;
    readonly message?: string;
    readonly details?: unknown;
  };
  readonly revisions: CodeCellRevisions | null;
}

export interface CodeCellAdapter {
  readonly handle: (request: unknown) => Promise<CodeCellResponse<unknown>>;
}

/** Freeze the revision triple returned by the editor state seam. */
function revisionsFrom(state: CodeCellDocumentState): CodeCellRevisions {
  return Object.freeze({
    chartFingerprint: state.revisions.chartFingerprint,
    diskSnapshot: state.revisions.diskSnapshot,
    generation: state.revisions.generation,
  });
}

type Parsed<T> = { readonly ok: true; readonly value?: T } | { readonly ok: false };

/** Parse the optional revision pin accepted by a cell request. */
function parseRevisionPin(value: unknown): Parsed<Partial<CodeCellRevisions>> {
  if (value === undefined) {
    return { ok: true };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  for (const key of ["chartFingerprint", "diskSnapshot"] as const) {
    const revision = value[key];
    if (revision !== undefined && revision !== null && typeof revision !== "string") {
      return { ok: false };
    }
  }
  const generation = value.generation;
  if (
    generation !== undefined &&
    (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0)
  ) {
    return { ok: false };
  }
  return { ok: true, value: value as Partial<CodeCellRevisions> };
}

interface CodeCellRunParams {
  readonly source: string;
  readonly profile?: CodeCellProfile;
  readonly args?: unknown;
  readonly expected?: Partial<CodeCellRevisions>;
  readonly timeoutMs?: number;
}

/** Validate the public request envelope before starting a sandbox. */
function codeCellRunOptions(value: unknown): CodeCellRunParams | null {
  if (!isRecord(value) || typeof value.source !== "string" || !value.source.trim()) {
    return null;
  }
  const profile = value.profile;
  if (profile !== undefined && !isCodeCellProfile(profile)) {
    return null;
  }
  if (value.args !== undefined && value.args !== null && typeof value.args !== "object") {
    return null;
  }
  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== "number" ||
      !Number.isSafeInteger(value.timeoutMs) ||
      value.timeoutMs < 1_000 ||
      value.timeoutMs > 20_000)
  ) {
    return null;
  }
  const expected = parseRevisionPin(value.expected);
  if (!expected.ok) {
    return null;
  }
  return {
    source: value.source,
    ...(profile !== undefined ? { profile } : {}),
    ...(value.args !== undefined ? { args: value.args } : {}),
    ...(expected.value ? { expected: expected.value } : {}),
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs as number } : {}),
  };
}

/** Codes that the HTTP transport maps to a non-success status. */
const CELL_RUN_TRANSPORT_CODES: Partial<Record<CodeCellErrorCode, string>> = Object.freeze({
  disabled: "disabled",
  invalid_request: "invalid_request",
  stale_read: "stale_read",
  runtime: "runtime",
  busy: "busy",
  timeout: "timeout",
  cancelled: "cancelled",
});

/** Build a failed response with the current editor revisions. */
function failure(
  code: string,
  revisions: CodeCellRevisions | null,
  message?: string,
  details?: unknown,
): CodeCellResponse<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      ...(message ? { message } : {}),
      ...(details === undefined ? {} : { details }),
    }),
    revisions,
  });
}

/** Run one cell after checking its optimistic-concurrency pin. */
async function runCell(
  options: CodeCellAdapterOptions,
  params: CodeCellRunParams,
  current: CodeCellRevisions,
): Promise<CodeCellResponse<CodeCellResult>> {
  if (!options.code) {
    return failure("disabled", current, "Code execution is unavailable");
  }
  const conflicts = revisionConflicts(params.expected, current);
  if (conflicts.length) {
    return failure("stale_read", current, "Code cell base revision is stale", {
      conflicts,
      expected: params.expected,
      current,
    });
  }
  try {
    const result = await options.code.run({
      source: params.source,
      profile: params.profile ?? "write",
      ...(params.args !== undefined ? { args: params.args } : {}),
      ...(params.expected !== undefined ? { expected: params.expected } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
    });
    const after = revisionsFrom(options.state());
    if (result.error) {
      const code = CELL_RUN_TRANSPORT_CODES[result.error.code];
      if (code) {
        return failure(code, after, result.error.message, result);
      }
    }
    return Object.freeze({ ok: true, value: result, revisions: after });
  } catch (error) {
    return failure(
      "failed",
      revisionsFrom(options.state()),
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Build the HTTP-facing Code Cell adapter for one mounted editor. */
export function createCodeCellAdapter(options: CodeCellAdapterOptions): CodeCellAdapter {
  const handle = async (request: unknown): Promise<CodeCellResponse<unknown>> => {
    let current: CodeCellRevisions;
    try {
      current = revisionsFrom(options.state());
    } catch (error) {
      return failure("failed", null, error instanceof Error ? error.message : String(error));
    }
    if (!isRecord(request) || typeof request.method !== "string") {
      return failure("invalid_request", current, "Code Cell request must contain a method");
    }
    if (request.method === "cell.guide") {
      if (request.params !== undefined) {
        return failure("invalid_request", current, "cell.guide does not accept params");
      }
      return Object.freeze({
        ok: true,
        value: Object.freeze({ text: getCodeCellGuide() }),
        revisions: current,
      });
    }
    if (request.method === "cell.frame") {
      if (options.enabled && !options.enabled()) {
        return failure("disabled", current, "Code execution is unavailable");
      }
      if (!options.frame) {
        return failure("unavailable", current, "Frame rendering is unavailable");
      }
      let spec: PreviewFrameSpec;
      try {
        spec = normalizePreviewFrameRequest(request.params);
      } catch (error) {
        return failure(
          "invalid_request",
          current,
          error instanceof Error ? error.message : String(error),
        );
      }
      try {
        const frame = await options.frame(spec);
        return Object.freeze({
          ok: true,
          value: Object.freeze(frame),
          revisions: current,
        });
      } catch (error) {
        return failure("runtime", current, error instanceof Error ? error.message : String(error));
      }
    }
    if (request.method !== "cell.run") {
      return failure(
        "method_not_allowed",
        current,
        `Code Cell method is not available: ${request.method}`,
      );
    }
    const params = codeCellRunOptions(request.params);
    if (!params) {
      return failure("invalid_request", current, "cell.run parameters are invalid");
    }
    return runCell(options, params, current);
  };

  return Object.freeze({ handle });
}
