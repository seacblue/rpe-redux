/* eslint-disable max-lines -- script registration, execution, parameters, and UI capabilities share one registry. */
/** Extension-owned script registration, parameter resolution, shortcuts, and run history. */
import { getSelectionSession } from "../edit/selection/api.ts";
import { chart as chartApi, type ChartHandle } from "../api/chart.ts";
import { selection as selectionApi, type SelectionHandle } from "../api/selection.ts";
import { transaction as transactionApi, type TransactionHandle } from "../api/transaction.ts";
import type { ReduxApi } from "../api/index.ts";
import { shortcutRegistry } from "../shortcuts/registry.ts";
import type { Shortcut, ShortcutDisposer, ShortcutScope } from "../shortcuts/types.ts";
import type { TrustedExtensionManifest } from "./extensionRuntime.ts";
import {
  getScriptUiHost,
  getScriptParameterHost,
  requireScriptUiHost,
  type ScriptUiGuideResult,
  type ScriptUiProgressHandle,
  type ScriptUiInputOptions,
  type ScriptUiSelectOptions,
  type ScriptUiCapability,
  type ScriptUiHost,
  type ScriptUiRequest,
  type ScriptUiSource,
  type ParamValue,
} from "./scriptUi.ts";
import {
  defaultValues,
  resolveParameterValues,
  validateParameterValues,
  type ExtensionParameterInput,
  type ExtensionParameterIssue,
  type ExtensionParameterSchema,
  type ExtensionParameterValue,
} from "./parameters.ts";
import {
  getExtensionUiHost,
  requireExtensionUiHost,
  type ExtensionPanelDefinition,
  type ExtensionOverlayDefinition,
  type ExtensionSidebarDefinition,
  type ExtensionUiCapability,
  type ExtensionUiRequest,
} from "./extensionUi.ts";
import type { ExtensionDisposer } from "./registry.ts";
import type {
  ExtensionDesignCatalog,
  ExtensionDesignEvent,
  ExtensionDesignNode,
  ExtensionDesignPanelDefinition,
} from "./designComponents.ts";
import {
  ExtensionCapabilityError,
  requireExtensionCapability,
  type ExtensionCapability,
} from "./capabilities.ts";
import { gatedSelection } from "./selectionGate.ts";
import {
  createExtensionI18n,
  extensionTextKey,
  resolveExtensionText,
  type ExtensionText,
  type ExtensionTranslations,
} from "./i18n.ts";
import { runSteps, type ExtensionScriptStep } from "./steps.ts";
import {
  appendScriptRun,
  recentScriptIds,
  subscribeScriptRunHistory,
  type ScriptRunStatus,
} from "./scriptRunHistory.ts";
import { tRaw } from "../../i18n/index.ts";

export type { ExtensionScriptStep } from "./steps.ts";

/** Capability-gated editor handles one script can reach. */
export interface ScriptEditorContext {
  readonly selection: SelectionHandle;
  readonly chart: ChartHandle;
  readonly transaction: TransactionHandle;
}

/** Host UI handles available to one Extension, each checked against its grant. */
export interface ScriptUiContext {
  readonly capabilities: readonly (ScriptUiCapability | ExtensionUiCapability)[];
  notice(message: ExtensionText, options?: Parameters<ScriptUiHost["notice"]>[2]): void;
  confirm(message: ExtensionText): Promise<boolean>;
  progress(title: ExtensionText, totalSteps?: number): ScriptUiProgressHandle;
  input(options: ScriptInputOptions): Promise<string | null>;
  select(options: ScriptSelectOptions): Promise<string | null>;
  guide(options: ScriptGuideOptions): Promise<ScriptUiGuideResult>;
  registerPanel(definition: ExtensionPanelDefinition): ExtensionDisposer;
  designCatalog(): Promise<ExtensionDesignCatalog>;
  registerDesignPanel(
    definition: Omit<ExtensionDesignPanelDefinition, "onEvent"> & {
      readonly component: ExtensionDesignNode;
      onEvent?(event: ExtensionDesignEvent): void;
    },
  ): ExtensionDisposer;
  registerSidebar(definition: ExtensionSidebarDefinition): ExtensionDisposer;
  registerOverlay(definition: ExtensionOverlayDefinition): ExtensionDisposer;
}

export type { ParamValue } from "./scriptUi.ts";

/** Options for a single-line or multiline text prompt. */
export interface ScriptInputOptions {
  readonly title: ExtensionText;
  readonly description?: ExtensionText;
  readonly defaultValue?: string;
  readonly placeholder?: ExtensionText;
  readonly multiline?: boolean;
  readonly confirmLabel?: ExtensionText;
  readonly cancelLabel?: ExtensionText;
}

export interface ScriptSelectOption {
  readonly value: string;
  readonly label: ExtensionText;
  readonly disabled?: boolean;
}

/** Options for a single-choice selection prompt. */
export interface ScriptSelectOptions {
  readonly title: ExtensionText;
  readonly description?: ExtensionText;
  readonly options: readonly ScriptSelectOption[];
  readonly defaultValue?: string;
  readonly cancelLabel?: ExtensionText;
}

export interface ScriptGuideStep {
  readonly title: ExtensionText;
  readonly description?: ExtensionText;
  readonly input?: ScriptInputOptions;
  readonly select?: ScriptSelectOptions;
}

export interface ScriptGuideOptions {
  readonly title: ExtensionText;
  readonly description?: ExtensionText;
  readonly steps: readonly ScriptGuideStep[];
  readonly previousLabel?: ExtensionText;
  readonly nextLabel?: ExtensionText;
  readonly cancelLabel?: ExtensionText;
  readonly finishLabel?: ExtensionText;
}

/** The context an Extension script receives when it runs. */
export interface ExtensionScriptContext {
  readonly manifest: TrustedExtensionManifest;
  readonly signal: AbortSignal;
  readonly api: ReduxApi;
  readonly i18n: ReturnType<typeof createExtensionI18n>;
  readonly editor: ScriptEditorContext;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly ui: ScriptUiContext;
}

/** A script contribution: either a code runner or declarative steps, never both. */
export interface ExtensionScriptDefinition {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly defaultShortcuts?: readonly Shortcut[];
  /** Where the script shortcut runs; defaults to the editor workspace. */
  readonly shortcutScope?: ShortcutScope;
  readonly parameters?: ExtensionParameterSchema;
  /** A sandboxed code contribution, or a declarative steps contribution, but not both. */
  readonly steps?: readonly ExtensionScriptStep[];
  run?(context: ExtensionScriptContext): void | Promise<void>;
}

/** The immutable listing entry for one registered script. */
export interface ExtensionScriptSnapshot {
  readonly id: string;
  readonly scriptId: string;
  readonly owner: string;
  readonly manifest: TrustedExtensionManifest;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly parameters?: ExtensionParameterSchema;
  readonly steps?: readonly ExtensionScriptStep[];
}

/** The result of one script invocation; failures carry a readable reason. */
export type ExtensionScriptResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Everything the registry needs to run one registered script. */
interface ScriptRecord {
  readonly definition: ExtensionScriptDefinition;
  readonly owner: string;
  readonly manifest: TrustedExtensionManifest;
  readonly scriptId: string;
  readonly signal: AbortSignal;
  readonly translations: ExtensionTranslations | undefined;
  /** Capability-gated facade for this package, resolved when a script runs. */
  readonly api: () => ReduxApi;
  readonly onFailure: ((error: unknown, action: string) => void) | undefined;
}

interface OwnerShortcutGroup {
  readonly categoryId: string;
  readonly dispose: () => void;
  count: number;
}

const records = new Map<string, ScriptRecord>();
const listeners = new Set<() => void>();
const ownerGroups = new Map<string, OwnerShortcutGroup>();
const rememberedParameters = new Map<string, Readonly<Record<string, ExtensionParameterInput>>>();
let nextCategoryOrder = 900;
let snapshot: readonly ExtensionScriptSnapshot[] = Object.freeze([]);
let recentSnapshot: readonly ExtensionScriptSnapshot[] = Object.freeze([]);

/** Registry key for one owner script. */
function scriptKey(owner: string, id: string): string {
  return `${owner}:${id}`;
}

/** Declarative steps still have to obey the capabilities their manifest declares. */
function requireStepCapabilities(
  steps: readonly ExtensionScriptStep[],
  granted: ReadonlySet<ExtensionCapability>,
): void {
  for (const step of steps) {
    if (step.op === "transaction" || step.op === "batch") {
      requireExtensionCapability(granted, "chart.read", `steps.${step.op}`);
      requireExtensionCapability(granted, "chart.write", `steps.${step.op}`);
      requireExtensionCapability(granted, "selection.read", `steps.${step.op}`);
    } else if (step.op === "select") {
      requireExtensionCapability(granted, "selection.read", "steps.select");
      requireExtensionCapability(granted, "selection.write", "steps.select");
    } else if (step.op === "notice") {
      requireExtensionCapability(granted, "ui.notice", "steps.notice");
    }
  }
}

/** Host-qualified shortcut id for one owner script. */
function scriptId(owner: string, id: string): string {
  return `extension.${owner}.script.${id}`;
}

/** Former shortcut id whose stored bindings migrate to the Extension id. */
function legacyScriptId(owner: string, id: string): string {
  return `mod.${owner}.script.${id}`;
}

/** Build the request origin shown by host UI. */
function sourceOf(
  manifest: TrustedExtensionManifest,
  translations: ExtensionTranslations | undefined,
): ScriptUiSource {
  return {
    id: manifest.id,
    name: resolveExtensionText(manifest.id, translations, { key: "name" }),
  };
}

/** Resolve live editor handles, or null when any required handle is unavailable. */
function editor(): ScriptEditorContext | null {
  if (
    selectionApi.availability().status !== "available" ||
    chartApi.availability().status !== "available" ||
    transactionApi.availability().status !== "available"
  ) {
    return null;
  }
  return {
    selection: selectionApi,
    chart: chartApi,
    transaction: transactionApi,
  };
}

/** Notify script listeners over a copy of the subscriber set. */
function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Rebuild the full and recent-first listings from registered records. */
function refreshSnapshot(): void {
  snapshot = Object.freeze(
    [...records.values()].map((record) =>
      Object.freeze({
        id: scriptKey(record.owner, record.definition.id),
        scriptId: record.scriptId,
        owner: record.owner,
        manifest: record.manifest,
        label: extensionTextKey(record.owner, record.definition.label),
        ...(record.definition.description
          ? { description: extensionTextKey(record.owner, record.definition.description) }
          : {}),
        ...(record.definition.icon ? { icon: record.definition.icon } : {}),
        ...(record.definition.parameters ? { parameters: record.definition.parameters } : {}),
        ...(record.definition.steps ? { steps: record.definition.steps } : {}),
      }),
    ),
  );
  const recency = new Map(recentScriptIds().map((id, index) => [id, index]));
  recentSnapshot = Object.freeze(
    [...snapshot].sort(
      (left, right) =>
        (recency.get(left.id) ?? recency.size) - (recency.get(right.id) ?? recency.size),
    ),
  );
}

subscribeScriptRunHistory(() => {
  refreshSnapshot();
  notify();
});

/**
 * Build the UI handles for one package.
 *
 * `granted` is the manifest's capability set; each method checks its own
 * capability before reaching the host adapter.
 */
export function createExtensionUiContext(
  manifest: TrustedExtensionManifest,
  translations: ExtensionTranslations | undefined,
  signal: AbortSignal,
  granted: ReadonlySet<ExtensionCapability> = new Set(),
): ScriptUiContext {
  const requireCapability = (capability: ExtensionCapability, action: string): void => {
    requireExtensionCapability(granted, capability, action);
  };
  const source = sourceOf(manifest, translations);
  const request: ScriptUiRequest = { source, signal };
  const surfaceRequest: ExtensionUiRequest = { source, signal };
  const capabilities = [
    ...(getScriptUiHost()?.capabilities ?? []),
    ...(getExtensionUiHost()?.capabilities ?? []),
  ];
  const resolveInput = (options: ScriptInputOptions): ScriptUiInputOptions => ({
    title: resolveExtensionText(manifest.id, translations, options.title),
    ...(options.description === undefined
      ? {}
      : { description: resolveExtensionText(manifest.id, translations, options.description) }),
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
    ...(options.placeholder === undefined
      ? {}
      : { placeholder: resolveExtensionText(manifest.id, translations, options.placeholder) }),
    ...(options.multiline === undefined ? {} : { multiline: options.multiline }),
    ...(options.confirmLabel === undefined
      ? {}
      : { confirmLabel: resolveExtensionText(manifest.id, translations, options.confirmLabel) }),
    ...(options.cancelLabel === undefined
      ? {}
      : { cancelLabel: resolveExtensionText(manifest.id, translations, options.cancelLabel) }),
  });
  const resolveSelect = (options: ScriptSelectOptions): ScriptUiSelectOptions => ({
    title: resolveExtensionText(manifest.id, translations, options.title),
    ...(options.description === undefined
      ? {}
      : { description: resolveExtensionText(manifest.id, translations, options.description) }),
    options: options.options.map((option) => ({
      value: option.value,
      label: resolveExtensionText(manifest.id, translations, option.label),
      ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
    })),
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
    ...(options.cancelLabel === undefined
      ? {}
      : { cancelLabel: resolveExtensionText(manifest.id, translations, options.cancelLabel) }),
  });
  return {
    capabilities,
    notice: (message, options) => {
      requireCapability("ui.notice", "ui.notice");
      return requireScriptUiHost("notice").notice(
        request,
        resolveExtensionText(manifest.id, translations, message),
        options,
      );
    },
    confirm: (message) => {
      requireCapability("ui.dialog", "ui.confirm");
      return requireScriptUiHost("confirm").confirm(
        request,
        resolveExtensionText(manifest.id, translations, message),
      );
    },
    progress: (title, totalSteps) => {
      requireCapability("ui.notice", "ui.progress");
      return requireScriptUiHost("progress").progress(
        request,
        resolveExtensionText(manifest.id, translations, title),
        totalSteps,
      );
    },
    input: (options) => {
      requireCapability("ui.dialog", "ui.input");
      return requireScriptUiHost("input").input(request, resolveInput(options));
    },
    select: (options) => {
      requireCapability("ui.dialog", "ui.select");
      return requireScriptUiHost("select").select(request, resolveSelect(options));
    },
    guide: (options) => {
      requireCapability("ui.dialog", "ui.guide");
      return requireScriptUiHost("guide").guide(request, {
        title: resolveExtensionText(manifest.id, translations, options.title),
        ...(options.description === undefined
          ? {}
          : { description: resolveExtensionText(manifest.id, translations, options.description) }),
        steps: options.steps.map((step) => ({
          title: resolveExtensionText(manifest.id, translations, step.title),
          ...(step.description === undefined
            ? {}
            : { description: resolveExtensionText(manifest.id, translations, step.description) }),
          ...(step.input === undefined ? {} : { input: resolveInput(step.input) }),
          ...(step.select === undefined ? {} : { select: resolveSelect(step.select) }),
        })),
        ...(options.previousLabel === undefined
          ? {}
          : {
              previousLabel: resolveExtensionText(manifest.id, translations, options.previousLabel),
            }),
        ...(options.nextLabel === undefined
          ? {}
          : { nextLabel: resolveExtensionText(manifest.id, translations, options.nextLabel) }),
        ...(options.cancelLabel === undefined
          ? {}
          : { cancelLabel: resolveExtensionText(manifest.id, translations, options.cancelLabel) }),
        ...(options.finishLabel === undefined
          ? {}
          : { finishLabel: resolveExtensionText(manifest.id, translations, options.finishLabel) }),
      });
    },
    registerPanel: (definition) => {
      requireCapability("ui.panel", "ui.registerPanel");
      return requireExtensionUiHost("panel").registerPanel(surfaceRequest, definition);
    },
    designCatalog: async () => {
      requireCapability("ui.panel", "ui.designCatalog");
      return requireExtensionUiHost("panel").designCatalog();
    },
    registerDesignPanel: (definition) => {
      requireCapability("ui.panel", "ui.registerDesignPanel");
      return requireExtensionUiHost("panel").registerDesignPanel(surfaceRequest, definition);
    },
    registerSidebar: (definition) => {
      requireCapability("ui.sidebar", "ui.registerSidebar");
      return requireExtensionUiHost("sidebar").registerSidebar(surfaceRequest, definition);
    },
    registerOverlay: (definition) => {
      requireCapability("ui.overlay", "ui.registerOverlay");
      return requireExtensionUiHost("overlay").registerOverlay(surfaceRequest, definition);
    },
  };
}

/** Create or reuse the shortcut category shared by one owner's scripts. */
function registerOwnerGroup(owner: string, manifest: TrustedExtensionManifest): OwnerShortcutGroup {
  const existing = ownerGroups.get(owner);
  if (existing) {
    existing.count += 1;
    return existing;
  }
  const registration = shortcutRegistry.registerCategory({
    id: `extension.${owner}`,
    title: extensionTextKey(owner, { key: "category" }),
    order: nextCategoryOrder++,
  });
  const group = { categoryId: registration.id, dispose: registration.dispose, count: 1 };
  ownerGroups.set(owner, group);
  return group;
}

/** Drop one owner-group reference; the last release disposes the category. */
function releaseOwnerGroup(owner: string): void {
  const group = ownerGroups.get(owner);
  if (!group) {
    return;
  }
  group.count -= 1;
  if (group.count <= 0) {
    group.dispose();
    ownerGroups.delete(owner);
  }
}

/** Build the gated script context, including editor and UI handles. */
function contextFor(
  record: ScriptRecord,
  params: Readonly<Record<string, ParamValue>>,
): ExtensionScriptContext {
  const currentEditor = editor();
  if (!currentEditor) {
    throw new Error("Editor runtime is unavailable");
  }
  const granted = new Set(record.manifest.capabilities ?? []);
  const requireCapability = (capability: ExtensionCapability, action: string): void => {
    requireExtensionCapability(granted, capability, action);
  };
  const gatedEditor: ScriptEditorContext = {
    get selection() {
      if (!granted.has("selection.read") && !granted.has("selection.write")) {
        throw new ExtensionCapabilityError("selection.read", "editor.selection");
      }
      return {
        ...gatedSelection(currentEditor.selection, granted),
        availability: currentEditor.selection.availability,
      };
    },
    get chart() {
      requireCapability("chart.read", "editor.chart");
      return currentEditor.chart;
    },
    get transaction() {
      requireCapability("chart.write", "editor.transaction");
      return currentEditor.transaction;
    },
  };
  return {
    manifest: record.manifest,
    signal: record.signal,
    api: record.api(),
    editor: gatedEditor,
    params,
    i18n: createExtensionI18n(record.owner, record.translations),
    ui: createExtensionUiContext(
      record.manifest,
      record.translations,
      record.signal,
      new Set(record.manifest.capabilities ?? []),
    ),
  };
}

/** Freeze a resolved parameter map, copying any array values. */
function frozenValues(
  values: Readonly<Record<string, ExtensionParameterValue>>,
): Readonly<Record<string, ParamValue>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        Array.isArray(value) ? Object.freeze([...value]) : value,
      ]),
    ),
  );
}

/** Freeze a shallow copy of submitted parameter inputs. */
function frozenInputs(
  values: Readonly<Record<string, ExtensionParameterInput>>,
): Readonly<Record<string, ExtensionParameterInput>> {
  return Object.freeze({ ...values });
}

/** Current chart line count when the schema has a judge-line parameter, else 0. */
function currentJudgeLineCount(schema: ExtensionParameterSchema): number {
  return Object.values(schema.parameters).some((parameter) => parameter.kind === "judgeLine")
    ? (getSelectionSession()?.chart.judgeLineList?.length ?? 0)
    : 0;
}

/** Validated values plus the unmodified inputs kept for the next prompt. */
type CollectedParameterValues =
  | {
      readonly ok: true;
      readonly values: Readonly<Record<string, ParamValue>>;
      readonly inputs: Readonly<Record<string, ExtensionParameterInput>>;
    }
  | { readonly ok: false; readonly issues: readonly ExtensionParameterIssue[] };

/** Validate raw values, then resolve judge-line picks and freeze both maps. */
function collectParameterValues(
  schema: ExtensionParameterSchema,
  raw: Readonly<Record<string, unknown>>,
  lineCount: number,
): CollectedParameterValues {
  const validated = validateParameterValues(schema, raw, { lineCount });
  if (!validated.ok) {
    return validated;
  }
  const resolved = resolveParameterValues(schema, validated.values, { lineCount });
  if (!resolved.ok) {
    return resolved;
  }
  return {
    ok: true,
    values: frozenValues(resolved.values),
    inputs: frozenInputs(validated.values),
  };
}

/** Format the first validation issue as a readable run reason. */
function invalidParameterReason(
  record: ScriptRecord,
  issue: { readonly key: string; readonly message: ExtensionText },
): string {
  return `Invalid parameter "${issue.key}": ${resolveExtensionText(
    record.owner,
    record.translations,
    issue.message,
  )}`;
}

let runHistoryFailureNotified = false;

/** Warn once that the run log could not be saved; missing UI must not fail the script. */
function reportRunHistoryFailure(record: ScriptRecord): void {
  if (runHistoryFailureNotified) {
    return;
  }
  runHistoryFailureNotified = true;
  try {
    createExtensionUiContext(record.manifest, record.translations, record.signal).notice(
      tRaw("extensions.runLog.saveFailed"),
      { level: "warning", timeoutMs: 8000 },
    );
  } catch {
    // A missing UI host must not change the script result.
  }
}

/** Persist a run record when the script declares parameters. */
function recordRun(
  record: ScriptRecord,
  params: Readonly<Record<string, unknown>>,
  status: ScriptRunStatus,
  affectedCount: number,
): void {
  if (!record.definition.parameters) {
    return;
  }
  const declaredParams = Object.fromEntries(
    Object.keys(record.definition.parameters.parameters)
      .filter((key) => Object.hasOwn(params, key))
      .map((key) => [key, params[key]]),
  );
  if (
    !appendScriptRun({
      owner: record.owner,
      scriptId: record.definition.id,
      params: declaredParams,
      affectedCount,
      status,
    })
  ) {
    reportRunHistoryFailure(record);
  }
}

/** Resolved values plus the raw values used to remember the prompt state. */
type ParameterResolution =
  | {
      readonly ok: true;
      readonly values: Readonly<Record<string, ParamValue>>;
      readonly rawValues: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly rawValues: Readonly<Record<string, unknown>>;
    };

/** Options for one script invocation; interactive prompts default to enabled. */
interface ScriptRunOptions {
  readonly interactive?: boolean;
  /**
   * Test-only override for the script body budget.
   *
   * The override exists so tests can observe a timeout without waiting for the
   * default. It never changes the budget callers get when they omit options.
   */
  readonly timeoutMs?: number;
}

/** Default wall-clock budget for one script body; interactive prompts are excluded. */
export const SCRIPT_RUN_TIMEOUT_MS = 30_000;

/** Stable error code reported when a script body exceeds its budget. */
const SCRIPT_TIMEOUT_CODE = "scriptTimeout";

/** Rejection used when the package was unloaded or disabled while its script ran. */
class ScriptCancelledError extends Error {
  readonly code = "scriptCancelled";

  constructor(scriptId: string) {
    super(`Script "${scriptId}" was cancelled`);
    this.name = "ScriptCancelledError";
  }
}

/** Budget failure whose message starts with the stable `scriptTimeout` code. */
class ScriptTimeoutError extends Error {
  readonly code = SCRIPT_TIMEOUT_CODE;

  constructor(scriptId: string, timeoutMs: number) {
    super(`${SCRIPT_TIMEOUT_CODE}: Script "${scriptId}" did not finish within ${timeoutMs} ms`);
    this.name = "ScriptTimeoutError";
  }
}

/** Resolve the effective budget, falling back to the default for invalid overrides. */
function scriptRunTimeoutMs(options: ScriptRunOptions): number {
  const override = options.timeoutMs;
  return typeof override === "number" && Number.isFinite(override) && override > 0
    ? override
    : SCRIPT_RUN_TIMEOUT_MS;
}

/**
 * Run one script body under a wall-clock budget.
 *
 * The timer is cleared as soon as the body settles. Aborting the package signal
 * rejects with `ScriptCancelledError`, so unloading an Extension during a run
 * settles the call without reporting a timeout.
 */
function withScriptTimeout<T>(
  body: () => T | Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  scriptId: string,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ScriptCancelledError(scriptId));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => settle(() => reject(new ScriptCancelledError(scriptId)));
    const timer = setTimeout(
      () => settle(() => reject(new ScriptTimeoutError(scriptId, timeoutMs))),
      timeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      Promise.resolve(body()).then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

/**
 * Resolve explicit, remembered, or interactively collected parameters.
 *
 * The returned raw values are always the inputs a retry would prefill.
 */
async function resolveParameters(
  key: string,
  record: ScriptRecord,
  explicitValues: Readonly<Record<string, unknown>> | undefined,
  interactive = true,
): Promise<ParameterResolution> {
  const schema = record.definition.parameters;
  if (!schema) {
    return { ok: true, values: Object.freeze({}), rawValues: Object.freeze({}) };
  }
  const lineCount = currentJudgeLineCount(schema);

  if (explicitValues !== undefined) {
    const rawValues = Object.freeze({ ...explicitValues });
    const collected = collectParameterValues(schema, explicitValues, lineCount);
    if (!collected.ok) {
      return {
        ok: false,
        reason: invalidParameterReason(record, collected.issues[0]),
        rawValues,
      };
    }
    rememberedParameters.set(key, collected.inputs);
    return { ok: true, values: collected.values, rawValues };
  }

  const initial = rememberedParameters.get(key) ?? frozenInputs(defaultValues(schema));
  if (!interactive) {
    const collected = collectParameterValues(schema, initial, lineCount);
    return collected.ok
      ? { ok: true, values: collected.values, rawValues: initial }
      : {
          ok: false,
          reason: invalidParameterReason(record, collected.issues[0]),
          rawValues: initial,
        };
  }
  const host = getScriptParameterHost();
  if (!host) {
    const collected = collectParameterValues(schema, initial, lineCount);
    return collected.ok
      ? { ok: true, values: collected.values, rawValues: initial }
      : {
          ok: false,
          reason: invalidParameterReason(record, collected.issues[0]),
          rawValues: initial,
        };
  }

  const collected = await host.collect(record.owner, record.definition.id, schema, initial);
  if (collected === null) {
    return { ok: false, reason: "Parameter collection was cancelled", rawValues: initial };
  }
  const result = collectParameterValues(schema, collected, lineCount);
  if (!result.ok) {
    return {
      ok: false,
      reason: invalidParameterReason(record, result.issues[0]),
      rawValues: Object.freeze({ ...collected }),
    };
  }
  rememberedParameters.set(key, result.inputs);
  return { ok: true, values: result.values, rawValues: Object.freeze({ ...collected }) };
}

/** Application-wide script registry keyed by owner-qualified script id. */
export const scriptRegistry = {
  /**
   * Register one script and its shortcut category.
   *
   * Throws for invalid ids, duplicate registrations, or a definition that
   * provides neither `run` nor `steps`.
   */
  register(
    owner: string,
    manifest: TrustedExtensionManifest,
    definition: ExtensionScriptDefinition,
    signal: AbortSignal,
    translations: ExtensionTranslations | undefined,
    api: () => ReduxApi,
    onFailure?: (error: unknown, action: string) => void,
  ): ExtensionDisposer {
    if (!definition || typeof definition.id !== "string" || !definition.id.trim()) {
      throw new Error("Extension script id must be non-empty");
    }
    if (typeof definition.run !== "function" && definition.steps === undefined) {
      throw new Error(`Extension script must provide run or steps: ${definition.id}`);
    }
    if (typeof definition.run === "function" && definition.steps !== undefined) {
      throw new Error(`Extension script cannot provide both run and steps: ${definition.id}`);
    }
    if (
      definition.parameters !== undefined &&
      (!definition.parameters ||
        typeof definition.parameters !== "object" ||
        !definition.parameters.parameters ||
        typeof definition.parameters.parameters !== "object")
    ) {
      throw new Error(`Extension script parameter schema is invalid: ${definition.id}`);
    }
    const key = scriptKey(owner, definition.id);
    if (records.has(key)) {
      throw new Error(`Extension script id is already registered: ${key}`);
    }
    if (definition.steps !== undefined) {
      requireStepCapabilities(definition.steps, new Set(manifest.capabilities ?? []));
    }
    const group = registerOwnerGroup(owner, manifest);
    const id = scriptId(owner, definition.id);
    const record: ScriptRecord = {
      definition,
      owner,
      manifest,
      scriptId: id,
      signal,
      translations,
      api,
      onFailure,
    };
    let shortcutDispose: ShortcutDisposer | undefined;
    try {
      shortcutDispose = shortcutRegistry.registerShortcut({
        id,
        category: group.categoryId,
        title: extensionTextKey(owner, definition.label),
        defaults: [...(definition.defaultShortcuts ?? [])],
        legacyStorageKey: legacyScriptId(owner, definition.id),
        scope: definition.shortcutScope ?? "editor",
        run: () => {
          void scriptRegistry.run(key);
        },
        enabled: () => !signal.aborted,
      });
      records.set(key, record);
      refreshSnapshot();
      notify();
    } catch (error) {
      shortcutDispose?.();
      releaseOwnerGroup(owner);
      throw error;
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      records.delete(key);
      rememberedParameters.delete(key);
      refreshSnapshot();
      shortcutDispose?.();
      releaseOwnerGroup(owner);
      notify();
    };
  },

  /**
   * Run one registered script; failures resolve with a readable reason.
   *
   * The script body (code runner or declarative steps) is limited to
   * `SCRIPT_RUN_TIMEOUT_MS`; an overrun fails with a reason prefixed
   * `scriptTimeout`. Aborting the package signal cancels the run without
   * consuming the failure budget.
   */
  async run(
    key: string,
    values?: Readonly<Record<string, unknown>>,
    options: ScriptRunOptions = {},
  ): Promise<ExtensionScriptResult> {
    const record = records.get(key);
    if (!record) {
      return { ok: false, reason: "Script is not registered" };
    }
    const granted = new Set(record.manifest.capabilities ?? []);
    let rawValues: Readonly<Record<string, unknown>> = values ?? Object.freeze({});
    let failedAffectedCount = 0;
    try {
      const params = await resolveParameters(key, record, values, options.interactive !== false);
      rawValues = params.rawValues;
      if (!params.ok) {
        recordRun(record, rawValues, "failed", 0);
        try {
          createExtensionUiContext(
            record.manifest,
            record.translations,
            record.signal,
            granted,
          ).notice(params.reason, { level: "error", timeoutMs: 8000 });
        } catch {
          // The script result remains useful to headless callers when no UI host exists.
        }
        return params;
      }
      let status: ScriptRunStatus = "committed";
      let affectedCount = 0;
      const timeoutMs = scriptRunTimeoutMs(options);
      // The budget covers the script body and the declarative step plan. It
      // starts after parameter prompts because a dialog legitimately waits for
      // the user.
      await withScriptTimeout(
        async () => {
          if (record.definition.steps !== undefined) {
            requireStepCapabilities(
              record.definition.steps,
              new Set(record.manifest.capabilities ?? []),
            );
            const session = getSelectionSession();
            const result = runSteps(session, record.definition.steps, {
              params: params.values,
              label: record.definition.label,
              metadata: {
                recipe: {
                  id: key,
                  name: record.definition.label,
                  version: Number.parseInt(record.manifest.version, 10) || 1,
                  params: params.values,
                },
              },
              onNotice: (message) =>
                createExtensionUiContext(
                  record.manifest,
                  record.translations,
                  record.signal,
                  granted,
                ).notice(message),
            });
            if (!result.ok) {
              failedAffectedCount = result.plan?.affectedObjectIds.length ?? 0;
              throw new Error(result.reason);
            }
            status = result.status;
            affectedCount = result.plan.affectedObjectIds.length;
          } else {
            await record.definition.run?.(contextFor(record, params.values));
          }
        },
        timeoutMs,
        record.signal,
        key,
      );
      recordRun(record, rawValues, status, affectedCount);
      return { ok: true };
    } catch (error) {
      if (error instanceof ScriptCancelledError) {
        // Unloading or disabling the package is not a script failure, so it
        // neither consumes the failure budget nor writes a failed run record.
        return { ok: false, reason: error.message };
      }
      const reason = error instanceof Error ? error.message : String(error);
      record.onFailure?.(error, `script.${record.definition.id}`);
      recordRun(record, rawValues, "failed", failedAffectedCount);
      try {
        createExtensionUiContext(
          record.manifest,
          record.translations,
          record.signal,
          granted,
        ).notice(reason, {
          level: "error",
          timeoutMs: 8000,
        });
      } catch {
        // The script result remains useful to headless callers when no UI host exists.
      }
      return { ok: false, reason };
    }
  },

  /** Every registered script in registration order. */
  list(): readonly ExtensionScriptSnapshot[] {
    return snapshot;
  },

  /** Registered scripts ordered by most recent run. */
  listRecentFirst(): readonly ExtensionScriptSnapshot[] {
    return recentSnapshot;
  },

  /** Owner-qualified ids ordered by most recent run. */
  recentIds(): readonly string[] {
    return recentScriptIds();
  },
  /** Observe registration and recency changes. */
  subscribe(listener: () => void): ExtensionDisposer {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Whether a host-qualified shortcut id belongs to a registered script. */
  hasScript(scriptId: string): boolean {
    return [...records.values()].some((record) => record.scriptId === scriptId);
  },
};
