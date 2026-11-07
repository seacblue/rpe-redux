/**
 * Runs one AI-authored code cell in the shared Extension sandbox.
 *
 * The runtime owns the one-shot lifecycle that `ExtensionRuntime` deliberately does
 * not: a synthetic cell identity, a fixed capability profile, a fresh iframe,
 * and an execution budget. It reuses the capability gate, the sandbox factory,
 * and the public Redux facade rather than introducing a second execution or
 * consent system. It keeps no run history; only a committed proposal reaches
 * the normal Edit history.
 */
import { appMajorVersion, BUILD_APP_VERSION } from "../platform/buildInfo.ts";
import type { ReduxApi } from "../api/index.ts";
import { randomToken } from "../collaboration/digest.ts";
import { revisionConflicts } from "../contracts/revisions.ts";
import { gateExtensionApi } from "../extensions/capabilityGate.ts";
import { requireExtensionApi } from "../extensions/extensionApi.ts";
import { ExtensionScope } from "../extensions/extensionRuntimeSupport.ts";
import type { ExtensionCapability } from "../extensions/capabilities.ts";
import type { MaterializedExtensionManifest } from "../extensions/extensionContract.ts";
import { PREFERENCE_SECTIONS, preferences } from "../state/preferences.ts";
import type {
  ExtensionSandboxFactory,
  ExtensionSandboxHost,
  SandboxCellError,
  SandboxCellResult,
} from "../extensions/sandbox.ts";
import { codeExecutionEnabled } from "./enabled.ts";
import { createCodeCellHostContext } from "./hostContext.ts";
import { codeCellCapabilities, isCodeCellProfile } from "./profiles.ts";
import { releaseCodeCellApi, restrictCodeCellApi } from "./restrictedApi.ts";
import type {
  CodeCellError,
  CodeCellErrorCode,
  CodeCellLog,
  CodeCellRequest,
  CodeCellResult,
  CodeCellRevisions,
} from "./contract.ts";

const MAX_SOURCE_BYTES = 100_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_RESULT_BYTES = 1_000_000;
/** The wrapper puts the submitted source on line 2; errors are shifted back. */
const CELL_SOURCE_LINE_OFFSET = 1;
const textEncoder = new TextEncoder();
const EMPTY_REVISIONS: CodeCellRevisions = Object.freeze({
  chartFingerprint: null,
  diskSnapshot: null,
  generation: 0,
});

/**
 * Wrap a submitted function body in the module entry the sandbox loads.
 *
 * The body runs in a module-scope `run` function, so it can see `redux` and
 * `input` but not the host context. `sourceURL` gives stack traces a stable
 * name; `CELL_SOURCE_LINE_OFFSET` removes the wrapper's first line.
 */
export function buildCodeCellSource(source: string, id: string): string {
  return [
    "const run = async (redux, input) => {",
    source,
    "};",
    "export default { async activate(context) { return await run(context.api, context.input); } };",
    `//# sourceURL=redux-cell-${id}.js`,
  ].join("\n");
}

/** Rank a sandbox failure so callers can retry or report it deliberately. */
function classifyCellError(error: SandboxCellError): CodeCellErrorCode {
  const name = error.name ?? "";
  const message = error.message ?? "";
  if (name === "TimeoutError") {
    return "timeout";
  }
  if (name === "AbortError") {
    return "cancelled";
  }
  if (name === "SyntaxError") {
    return "syntax";
  }
  if (message.includes("capability") || message.includes("Capability")) {
    return "capabilityDenied";
  }
  return "exception";
}

/**
 * Shift stack lines from the wrapper module back to the submitted source.
 *
 * Messages and stacks are rewritten to `redux-cell.js`; `line` and `column`
 * point into the submitted source when a matching frame is found.
 */
export function adjustCodeCellError(error: SandboxCellError | undefined): CodeCellError {
  if (!error) {
    return { code: "exception", message: "Code cell failed" };
  }
  const message = error.message || "Code cell failed";
  const stack = error.stack;
  const pattern = /redux-cell-[^\s:)]+\.js:(\d+):(\d+)/;
  const match = pattern.exec(stack ?? message);
  const adjust = (text: string): string =>
    text.replace(
      /redux-cell-[^\s:)]+\.js:(\d+):(\d+)/g,
      (_whole, line: string, column: string) =>
        `redux-cell.js:${Math.max(1, Number(line) - CELL_SOURCE_LINE_OFFSET)}:${column}`,
    );
  return {
    code: classifyCellError(error),
    ...(error.name ? { name: error.name } : {}),
    message: adjust(message),
    ...(stack ? { stack: adjust(stack) } : {}),
    ...(match
      ? {
          line: Math.max(1, Number(match[1]) - CELL_SOURCE_LINE_OFFSET),
          column: Number(match[2]),
        }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Clamp a caller budget to 1-20 seconds; non-finite input uses the 10 s default. */
function clampTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.round(value)));
}

/** Serialized UTF-8 size; unserializable values report infinity so the limit fails closed. */
function jsonByteLength(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value) ?? "").byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Host seams and defaults accepted by one runtime. */
export interface CodeCellRuntimeOptions {
  /** The frontend iframe factory; set by the application entry point. */
  sandboxFactory?: ExtensionSandboxFactory | null;
  /** Defaults to the mounted public facade. */
  api?: () => ReduxApi;
  /** Defaults to the `code-execution-enabled` setting. */
  enabled?: () => boolean;
  /** Subscribes to consent changes; defaults to the settings preference section. */
  watchEnabled?: (listener: () => void) => () => void;
  /** Defaults to an empty revision; the editor mount connects the real one. */
  revisions?: () => CodeCellRevisions;
  /** Clock used for durations; defaults to `Date.now`. */
  now?: () => number;
  /** Receives failures that must not fail the cell, such as cleanup errors. */
  reportFailure?: (error: unknown, action: string) => void;
}

/** Owns the mounted code-cell lifecycle and its single running state. */
export class CodeCellRuntime {
  private sandboxFactory: ExtensionSandboxFactory | null;
  private readonly apiProvider: () => ReduxApi;
  private readonly enabledProvider: () => boolean;
  private readonly enabledWatcher: (listener: () => void) => () => void;
  private readonly defaultRevisions: (() => CodeCellRevisions) | null;
  private revisionsProvider: (() => CodeCellRevisions) | null;
  private readonly now: () => number;
  private readonly reportFailure: (error: unknown, action: string) => void;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private activeRun: { sandbox: ExtensionSandboxHost | null; cancelRequested: boolean } | null =
    null;

  /** Create a runtime with optional host seams; defaults bind the mounted facade and setting. */
  constructor(options: CodeCellRuntimeOptions = {}) {
    this.sandboxFactory = options.sandboxFactory ?? null;
    this.apiProvider = options.api ?? requireExtensionApi;
    this.enabledProvider = options.enabled ?? codeExecutionEnabled;
    this.enabledWatcher =
      options.watchEnabled ??
      ((listener) => preferences.subscribe(PREFERENCE_SECTIONS.settings, listener));
    this.defaultRevisions = options.revisions ?? null;
    this.revisionsProvider = this.defaultRevisions;
    this.now = options.now ?? Date.now;
    const reportFailure =
      options.reportFailure ??
      ((error, action) => console.error(`[redux.codecell] ${action}`, error));
    this.reportFailure = (error, action) => {
      try {
        reportFailure(error, action);
      } catch {
        // Diagnostic reporting must never break lifecycle cleanup or listeners.
      }
    };
  }

  /** Attach the frontend-owned iframe factory; cells share the Extension sandbox. */
  setSandboxFactory(factory: ExtensionSandboxFactory | null): void {
    this.sandboxFactory = factory;
  }

  /**
   * Bind the mounted document's revision snapshot.
   *
   * The returned disposer restores the constructor default only while this
   * provider is still the connected one.
   */
  connectRevisions(provider: () => CodeCellRevisions): () => void {
    const token = provider;
    this.revisionsProvider = provider;
    return () => {
      if (this.revisionsProvider === token) {
        this.revisionsProvider = this.defaultRevisions;
      }
    };
  }

  /** Observe the running state for hosts that gate their own controls. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a cell currently owns the sandbox. */
  isRunning(): boolean {
    return this.active;
  }

  /** Stop the active cell; the run resolves with a `cancelled` result. */
  cancel(): void {
    const run = this.activeRun;
    if (!run) {
      return;
    }
    run.cancelRequested = true;
    try {
      run.sandbox?.dispose();
    } catch (error) {
      this.reportFailure(error, "cell.cancel");
    }
  }

  /** Execute one cell; code and runtime failures resolve as a result object. */
  async run(request: CodeCellRequest): Promise<CodeCellResult> {
    const failure = (
      code: CodeCellErrorCode,
      message: string,
      startRevisions: CodeCellRevisions = EMPTY_REVISIONS,
      endRevisions: CodeCellRevisions = startRevisions,
      capabilities: readonly ExtensionCapability[] = [],
      extra: Partial<CodeCellError> = {},
      logs: readonly CodeCellLog[] = [],
      durationMs = 0,
    ): CodeCellResult =>
      Object.freeze({
        ok: false,
        logs,
        error: Object.freeze({ code, message, ...extra }),
        durationMs,
        startRevisions,
        endRevisions,
        capabilities,
        truncated: false,
      });

    if (!this.isEnabled()) {
      return failure("disabled", "Code execution is disabled");
    }
    if (
      !request ||
      typeof request !== "object" ||
      typeof request.source !== "string" ||
      !request.source.trim()
    ) {
      return failure("invalid_request", "Code cell source must be a non-empty string");
    }
    const profile = request.profile ?? "write";
    if (!isCodeCellProfile(profile)) {
      return failure("invalid_request", `Unknown code cell profile: ${String(profile)}`);
    }
    const capabilities = codeCellCapabilities(profile);
    const source = request.source;
    if (textEncoder.encode(source).byteLength > MAX_SOURCE_BYTES) {
      return failure("invalid_request", `Code cell source exceeds ${MAX_SOURCE_BYTES} bytes`);
    }
    if (!this.revisionsProvider) {
      return failure(
        "runtime",
        "No editor document is mounted",
        EMPTY_REVISIONS,
        EMPTY_REVISIONS,
        capabilities,
      );
    }
    let startRevisions: CodeCellRevisions;
    try {
      startRevisions = this.readRevisions();
    } catch (error) {
      this.reportFailure(error, "cell.revisions");
      return failure(
        "runtime",
        `Code cell revision is unavailable: ${errorMessage(error)}`,
        EMPTY_REVISIONS,
        EMPTY_REVISIONS,
        capabilities,
      );
    }
    const conflicts = revisionConflicts(request.expected, startRevisions);
    if (conflicts.length) {
      return failure(
        "stale_read",
        `Code cell base revision is stale: ${conflicts.join(", ")}`,
        startRevisions,
        startRevisions,
        capabilities,
      );
    }
    if (this.active) {
      return failure(
        "busy",
        "A code cell is already running",
        startRevisions,
        startRevisions,
        capabilities,
      );
    }
    const factory = this.sandboxFactory;
    if (!factory) {
      return failure(
        "runtime",
        "Code cell sandbox is unavailable",
        startRevisions,
        startRevisions,
        capabilities,
      );
    }
    let api: ReduxApi;
    try {
      api = this.apiProvider();
    } catch (error) {
      return failure("runtime", errorMessage(error), startRevisions, startRevisions, capabilities);
    }

    const cellId = randomToken(8);
    const manifest: MaterializedExtensionManifest = Object.freeze({
      id: `cell.${cellId}`,
      name: "Code cell",
      version: "0.0.0",
      kind: "extension",
      engines: { "rpe-redux": appMajorVersion(BUILD_APP_VERSION) },
      capabilities,
    });
    const timeoutMs = clampTimeout(request.timeoutMs);
    const scope = new ExtensionScope();
    let sandbox: ExtensionSandboxHost | null = null;
    let restrictedApi: ReduxApi | null = null;
    let stopWatching = (): void => {};
    let result: CodeCellResult;
    const startedAt = this.now();
    const runState = { sandbox: null as ExtensionSandboxHost | null, cancelRequested: false };
    this.active = true;
    this.activeRun = runState;
    try {
      this.publish();
      try {
        stopWatching = this.enabledWatcher(() => {
          if (!this.isEnabled()) {
            this.cancel();
          }
        });
      } catch (error) {
        this.reportFailure(error, "cell.enabledWatch");
      }
      if (!this.isEnabled()) {
        this.cancel();
      }
      const gated = gateExtensionApi(api, new Set(capabilities), manifest.id);
      restrictedApi = restrictCodeCellApi(gated, {
        requestId: cellId,
        capabilities,
        baseRevisions: startRevisions,
        currentRevisions: () => {
          if (!this.revisionsProvider) {
            throw new Error("No editor document is mounted");
          }
          return this.revisionsProvider();
        },
        enabled: () => this.isEnabled(),
        reportFailure: (error, action) => this.reportFailure(error, action),
      });
      const context = createCodeCellHostContext(manifest, restrictedApi, scope);
      sandbox = factory({
        mode: "cell",
        manifest,
        translations: undefined,
        source: buildCodeCellSource(source, cellId),
        context,
        reportFailure: (error, action) => this.reportFailure(error, action),
        input: request.args,
        timeoutMs,
      });
      runState.sandbox = sandbox;
      if (runState.cancelRequested) {
        sandbox.dispose();
        throw new Error("Code cell was cancelled");
      }
      await sandbox.start();
      if (runState.cancelRequested) {
        throw new Error("Code cell was cancelled");
      }
      if (!this.isEnabled()) {
        this.cancel();
        throw new Error("Code execution is disabled");
      }
      const outcome = await (sandbox.runCell?.() ??
        Promise.resolve<SandboxCellResult>({
          ok: false,
          logs: [],
          error: { name: "Error", message: "Code cell result channel is unavailable" },
          durationMs: 0,
          truncated: false,
        }));
      const durationMs = Math.max(0, Math.round(outcome.durationMs || this.now() - startedAt));
      let endRevisions: CodeCellRevisions;
      try {
        endRevisions = this.readRevisions();
      } catch (error) {
        this.reportFailure(error, "cell.revisions");
        result = failure(
          "runtime",
          `Code cell revision is unavailable: ${errorMessage(error)}`,
          startRevisions,
          startRevisions,
          capabilities,
          {},
          outcome.logs ?? [],
          durationMs,
        );
        return result;
      }
      const outcomeError = outcome.ok ? undefined : adjustCodeCellError(outcome.error);
      const tooLarge =
        outcome.ok &&
        outcome.value !== undefined &&
        jsonByteLength(outcome.value) > MAX_RESULT_BYTES;
      const error =
        outcomeError ??
        (tooLarge
          ? {
              code: "runtime" as const,
              message: `Code cell result exceeds ${MAX_RESULT_BYTES} bytes`,
            }
          : undefined);
      const ok = outcome.ok === true && error === undefined;
      result = Object.freeze({
        id: cellId,
        ok,
        ...(ok && outcome.value !== undefined ? { value: outcome.value } : {}),
        logs: outcome.logs ?? [],
        ...(error ? { error } : {}),
        durationMs,
        startRevisions,
        endRevisions,
        capabilities,
        truncated: outcome.truncated === true || tooLarge,
      });
    } catch (error) {
      let endRevisions = startRevisions;
      try {
        endRevisions = this.readRevisions();
      } catch (revisionError) {
        this.reportFailure(revisionError, "cell.revisions");
      }
      const durationMs = Math.max(0, Math.round(this.now() - startedAt));
      if (runState.cancelRequested) {
        result = failure(
          "cancelled",
          "Code cell was cancelled",
          startRevisions,
          endRevisions,
          capabilities,
          {},
          [],
          durationMs,
        );
      } else if (!this.isEnabled()) {
        result = failure(
          "disabled",
          "Code execution was disabled",
          startRevisions,
          endRevisions,
          capabilities,
          {},
          [],
          durationMs,
        );
      } else {
        const name = error instanceof Error ? error.name : "";
        const code: CodeCellErrorCode =
          name === "AbortError" ? "cancelled" : name === "TimeoutError" ? "timeout" : "runtime";
        result = failure(
          code,
          errorMessage(error),
          startRevisions,
          endRevisions,
          capabilities,
          {},
          [],
          durationMs,
        );
      }
    } finally {
      try {
        stopWatching();
      } catch (error) {
        this.reportFailure(error, "cell.enabledWatch");
      }
      try {
        sandbox?.dispose();
      } catch (error) {
        this.reportFailure(error, "cell.dispose");
      }
      if (restrictedApi) {
        try {
          releaseCodeCellApi(restrictedApi);
        } catch (error) {
          this.reportFailure(error, "cell.previewRelease");
        }
      }
      try {
        scope.dispose();
      } catch (error) {
        this.reportFailure(error, "cell.cleanup");
      }
      if (this.activeRun === runState) {
        this.activeRun = null;
      }
      this.active = false;
      try {
        this.publish();
      } catch (error) {
        this.reportFailure(error, "cell.listener");
      }
    }
    return result;
  }

  /** Read the connected revision snapshot; a failure must abort the write path. */
  private readRevisions(): CodeCellRevisions {
    if (!this.revisionsProvider) {
      throw new Error("No editor document is mounted");
    }
    return this.revisionsProvider();
  }

  /** Read the execution consent, treating a throwing provider as disabled. */
  private isEnabled(): boolean {
    try {
      return this.enabledProvider();
    } catch (error) {
      this.reportFailure(error, "cell.enabled");
      return false;
    }
  }

  /** Notify subscribers over a copy, so unsubscribing during a pass is safe. */
  private publish(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        // A host surface observer must not strand the run in its busy state or
        // prevent other observers from updating.
        try {
          this.reportFailure(error, "cell.listener");
        } catch {
          // Failure reporting is diagnostic; it must never escape a publish.
        }
      }
    }
  }
}

/** The application-wide runtime; the editor mount binds its revision source. */
export const codeCellRuntime = new CodeCellRuntime();

/**
 * Install the debug/automation-only code-cell facade.
 *
 * Release builds never expose it; the sandbox and Code Cell bridge remain the product
 * surfaces. It mirrors `window.redux`'s development contract so the smoke suite
 * exercises the real iframe.
 */
export function installCodeCellApi(target: Window): void {
  const debugBuild =
    import.meta.env?.DEV === true ||
    (globalThis as { __REDUX_TEST_API__?: unknown }).__REDUX_TEST_API__ === true;
  if (!debugBuild || Object.hasOwn(target, "reduxCodeCell")) {
    return;
  }
  Object.defineProperty(target, "reduxCodeCell", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      run: (request: CodeCellRequest) => codeCellRuntime.run(request),
    }),
  });
}

declare global {
  interface Window {
    reduxCodeCell?: {
      run(request: CodeCellRequest): Promise<CodeCellResult>;
    };
  }
}
