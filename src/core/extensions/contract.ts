/**
 * Public payload maps for extension events and semantic hooks, the event-name
 * allowlist, and the facade contract.
 */
import type { ExtensionCallbackFailure } from "./registry.ts";
import type { Chart } from "../global/chart/chart.ts";
import type { HistoryEntryMetadata } from "../edit/session/history.ts";
import type { SelectionState } from "../edit/session/selectionHistory.ts";
import type { SelectionOperationResult, SelectionPasteRequest } from "../edit/selection/api.ts";
import type { ExtensionStatusSnapshot } from "./extensionRuntime.ts";

export interface SessionBeforeCommitPayload {
  label: string;
  chart: Chart;
  beforeSelection: SelectionState;
  metadata: HistoryEntryMetadata;
  cancel: boolean;
}

export interface SessionAfterCommitPayload {
  label: string;
  chart: Chart;
}

export interface ChartParsePayload {
  text: string;
  chart: Chart | null;
}

export interface ChartParsedPayload {
  chart: Chart;
}

export interface ChartValidatePayload {
  chart: unknown;
  handled: boolean;
}

export interface ChartSerializePayload {
  chart: unknown;
  compact: boolean;
  text: string | null;
}

export interface DocumentBeforeOpenPayload {
  source: "open" | "create" | "restore";
  cancel: boolean;
}

export interface DocumentBeforeCreatePayload {
  cancel: boolean;
}

export interface DocumentBeforeSavePayload {
  saveAs: boolean;
  cancel: boolean;
}

export interface DocumentBeforeClosePayload {
  cancel: boolean;
}

export interface DocumentLifecyclePayload {
  name: string;
  path: string | null;
  chart: Chart | null;
}

export interface SelectionBeforePastePayload {
  request: SelectionPasteRequest;
  cancel: boolean;
}

export interface SelectionAfterPastePayload {
  request: SelectionPasteRequest;
  result: SelectionOperationResult;
}

/** One committed chart revision; subscribers re-read when they need the data. */
export interface ChartChangedPayload {
  readonly label: string | null;
  readonly chartFingerprint: string | null;
  readonly reason: "commit" | "undo" | "redo" | "external";
}

/**
 * Built-in notifications currently emitted by the extension runtime.
 *
 * The map is closed: an event name that is not declared here cannot be
 * subscribed to, so exposing a new host event is an explicit contract change.
 */
export interface ExtensionEventPayloads {
  "extension:callback-error": ExtensionCallbackFailure;
  "document:opened": DocumentLifecyclePayload;
  "document:created": DocumentLifecyclePayload;
  "document:restored": DocumentLifecyclePayload;
  "document:saved": DocumentLifecyclePayload;
  "document:closed": DocumentLifecyclePayload;
  "chart:changed": ChartChangedPayload;
  "selection:after-paste": SelectionAfterPastePayload;
}

/**
 * Host events an Extension may subscribe to.
 *
 * A new host event stays invisible to packages until its name is added here
 * and documented. The list is deliberately explicit rather than derived from
 * the payload map: this array is the access decision.
 */
export const EXTENSION_EVENT_NAMES = Object.freeze([
  "extension:callback-error",
  "document:opened",
  "document:created",
  "document:restored",
  "document:saved",
  "document:closed",
  "chart:changed",
  "selection:after-paste",
] as const);

/** One event name an Extension may subscribe to. */
export type ExtensionEventName = (typeof EXTENSION_EVENT_NAMES)[number];

const EXTENSION_EVENT_NAME_SET: ReadonlySet<string> = new Set(EXTENSION_EVENT_NAMES);

/** Whether a value names an event the host publishes to packages. */
export function isExtensionEventName(value: unknown): value is ExtensionEventName {
  return typeof value === "string" && EXTENSION_EVENT_NAME_SET.has(value);
}

/** Stable code carried when a package requests an event outside the allowlist. */
export type ExtensionEventNameCode = "eventNotAllowed";

/** Thrown before a subscription is registered for an unknown host event. */
export class ExtensionEventNameError extends Error {
  readonly code: ExtensionEventNameCode = "eventNotAllowed";

  /** Build the refusal for the requested name without listing the allowlist. */
  constructor(name: string) {
    super(`Extension event is not subscribable: ${name}`);
    this.name = "ExtensionEventNameError";
  }
}

/** Semantic hook payloads are added with the lifecycle integrations. */
export interface ExtensionHookPayloads {
  "session:before-commit": SessionBeforeCommitPayload;
  "session:after-commit": SessionAfterCommitPayload;
  "chart:parse": ChartParsePayload;
  "chart:parsed": ChartParsedPayload;
  "chart:validate": ChartValidatePayload;
  "chart:serialize": ChartSerializePayload;
  "document:before-open": DocumentBeforeOpenPayload;
  "document:before-create": DocumentBeforeCreatePayload;
  "document:before-save": DocumentBeforeSavePayload;
  "document:before-close": DocumentBeforeClosePayload;
  "selection:before-paste": SelectionBeforePastePayload;
  [name: string]: unknown;
}

/**
 * Read-only Extension status for external observers.
 *
 * Package code reaches subscriptions and scripts through its capability-gated
 * `TrustedExtensionContext`. The global facade deliberately has no load/enable/
 * unload/run operations: one package must not be able to activate another
 * package or execute its scripts by reaching `window.redux`.
 */
export interface ExtensionsApi {
  readonly riskNotice: string;
  /** Every loaded package, in activation order. */
  list(): readonly ExtensionStatusSnapshot[];
  /** Observe status-list changes. */
  subscribe(listener: () => void): () => void;
}
