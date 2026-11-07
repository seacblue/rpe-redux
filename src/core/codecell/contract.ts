/**
 * The one-shot Code Cell contract shared by the sandbox host, the local bridge,
 * and the in-app runner.
 *
 * A code cell is an ephemeral program: it has a profile, arguments, a source
 * body, and a result. It is never registered as an Extension, never restored at
 * startup, and never receives a package fingerprint or persistent consent.
 */
import type { DocumentRevisions } from "../contracts/revisions.ts";
import type { ExtensionCapability } from "../extensions/capabilities.ts";
import type { SandboxCellLog } from "../extensions/sandbox.ts";

/** The capability profile a cell runs under. `write` can edit the open chart. */
export type CodeCellProfile = "read" | "write";

/** The edit-history origin kind for a transaction proposed by a code cell. */
export const CODE_CELL_HISTORY_ORIGIN = "code-cell";

/** The document revision a cell was started against and finished against. */
export type CodeCellRevisions = DocumentRevisions;

/** One console entry captured from the sandbox. */
export type CodeCellLog = SandboxCellLog;

/** A stable class for a failed cell so the client can decide whether to retry. */
export type CodeCellErrorCode =
  | "disabled"
  | "busy"
  | "stale_read"
  | "invalid_request"
  | "timeout"
  | "cancelled"
  | "syntax"
  | "exception"
  | "capabilityDenied"
  | "runtime";

/** A cell failure, with line numbers already adjusted to the submitted source. */
export interface CodeCellError {
  readonly code: CodeCellErrorCode;
  /**
   * The thrown error name. A capability denial raised on the host is an
   * `ExtensionCapabilityError`, but the bridge may report it as `Error`; branch
   * on `code`, not on this name.
   */
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

/** One request to execute a cell. */
export interface CodeCellRequest {
  readonly source: string;
  readonly profile?: CodeCellProfile;
  /** Exposed to the cell as `input`. */
  readonly args?: unknown;
  /** Optional revision pins checked before the cell starts. */
  readonly expected?: Partial<CodeCellRevisions>;
  /** Execution budget; defaults to 10 s and is capped at 20 s. */
  readonly timeoutMs?: number;
}

/** One completed cell. Code errors are a normal result, not a transport error. */

export interface CodeCellResult {
  /** The history id for this run; also used as the edit-history origin. */
  readonly id?: string;
  readonly ok: boolean;
  /** The returned JSON value; the worker encodes an `undefined` return as null. */
  readonly value?: unknown;
  readonly logs: readonly CodeCellLog[];
  readonly error?: CodeCellError;
  readonly durationMs: number;
  readonly startRevisions: CodeCellRevisions;
  readonly endRevisions: CodeCellRevisions;
  readonly capabilities: readonly ExtensionCapability[];
  readonly truncated: boolean;
}
