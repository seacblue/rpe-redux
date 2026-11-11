/* eslint-disable max-lines -- iframe lifecycle, bridge validation, and the declarative renderer share one adapter. */
/**
 * Runs one Extension in an opaque-origin iframe and bridges the narrow host
 * contract across a `MessagePort`.
 *
 * The iframe has no same-origin access, no Tauri IPC, and no network. Package
 * code reaches the app only through the capability-gated host context handed to
 * this adapter; UI is a declarative tree rendered by the host.
 */
import { createElement, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button } from "../../design/components/button/Button.tsx";
import { ColorField } from "../../design/components/input/ColorField.tsx";
import { Input } from "../../design/components/input/Input.tsx";
import { Select } from "../../design/components/select/Select.tsx";
import { Slider } from "../../design/components/slider/Slider.tsx";
import { createValue, type ValueCell, type ValueHandle } from "../../core/state/values.ts";
import { BUILD_APP_VERSION } from "../../core/platform/buildInfo.ts";
import { CELL_WORKER_SOURCE } from "../../core/codecell/workerSource.ts";
import { EXTENSION_TIMER_LIMITS } from "../../core/extensions/extensionRuntime.ts";
import {
  logExtensionCapabilityDenial,
  recordExtensionCapability,
  registerExtensionCapabilities,
} from "../../core/extensions/extensionApi.ts";
import { grantScriptDefaultShortcuts } from "../../core/extensions/extensionRuntimeSupport.ts";
import { projectExtensionEventPayload } from "../../core/extensions/capabilityGate.ts";
import type { ExtensionCapability } from "../../core/extensions/capabilities.ts";
import {
  ExtensionMethodRegistrationError,
  lookupMethod,
} from "../../core/extensions/methodRegistry.ts";
import {
  cloneForSandbox,
  createSandboxValueHandleTable,
  decodeBridgeArgs,
  encodeBridgeResult,
} from "./sandboxBridge.ts";
import { SandboxUiUpdateBudget, UI_UPDATE_BURST, UI_UPDATE_STEADY_HZ } from "./sandboxUiBudget.ts";
import { getLanguage } from "../../i18n/index.ts";
import type {
  ExtensionScriptDefinition,
  ExtensionScriptStep,
  ScriptUiContext,
} from "../../core/extensions/scripts.ts";
import type { ExtensionParameterSchema } from "../../core/extensions/parameters.ts";
import type { ExtensionText } from "../../core/extensions/i18n.ts";
import type { MaterializedExtensionManifest } from "../../core/extensions/extensionContract.ts";
import type {
  ExtensionSandboxFactoryInput,
  ExtensionSandboxHost,
  SandboxCellResult,
  SandboxPickedImage,
  SandboxStyle,
  SandboxUiEvent,
  SandboxUiNode,
} from "../../core/extensions/sandbox.ts";
import type {
  ExtensionDesignEvent,
  ExtensionDesignPanelDefinition,
} from "../../core/extensions/designComponents.ts";
import type {
  ExtensionDataInfo,
  ExtensionServiceInfo,
} from "../../core/extensions/serviceRegistry.ts";
import type { PublicHookPayloadSchema } from "../../core/extensions/publicHooks.ts";

const SANDBOX_READY_TIMEOUT_MS = 10_000;
const SANDBOX_LOAD_TIMEOUT_MS = 20_000;
const CELL_DEFAULT_TIMEOUT_MS = 10_000;
const CELL_MAX_TIMEOUT_MS = 20_000;
/**
 * The iframe owns the cell deadline and terminates its worker. The host keeps a
 * later fallback only for a broken bridge; it must not win the normal race.
 */
const HOST_CELL_FALLBACK_GRACE_MS = 1_000;
const MAX_UI_NODES = 256;
const MAX_UI_DEPTH = 16;
const MAX_CELL_LOGS = 200;
const MAX_IMAGE_BYTES = 512_000;
const BLOCKED_API_KEYS = new Set(["__proto__", "constructor", "prototype", "then", "toJSON"]);
const ALLOWED_TAGS = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "section",
  "label",
  "strong",
  "em",
  "img",
  "button",
  "input",
  "select",
  "option",
]);
const ALLOWED_INPUT_TYPES = new Set([
  "text",
  "search",
  "number",
  "range",
  "checkbox",
  "color",
  "url",
]);
const ALLOWED_ATTRS = new Set([
  "alt",
  "src",
  "placeholder",
  "min",
  "max",
  "step",
  "value",
  "checked",
  "disabled",
  "accept",
  "role",
  "aria-label",
  "aria-hidden",
  "aria-describedby",
  "data-tip-title",
  "data-tip-desc",
  "data-tip-key",
  "type",
  "action",
  "maxBytes",
]);
const STYLE_KEY = /^(?:--[A-Za-z0-9-]+|[A-Za-z-]+)$/u;
const IMAGE_SRC = /^(?:data:image\/|blob:)/iu;

/** One rendered declaration tree and the version that keys its remount. */
interface TreeState {
  readonly tree: SandboxUiNode;
  readonly version: number;
}

/** A bridge request awaiting its response. */
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** One hook callback request awaiting a sandbox response. */
interface PendingHookRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Messages exchanged with the sandbox iframe. */
interface SandboxPayload {
  type: string;
  token?: string;
  id?: number;
  method?: string;
  args?: unknown[];
  ok?: boolean;
  value?: unknown;
  error?:
    | string
    | {
        message?: string;
        code?: string;
        name?: string;
        stack?: string;
        details?: unknown;
      };
  action?: string;
  source?: string;
  workerSource?: string;
  mode?: string;
  input?: unknown;
  timeoutMs?: number;
  logs?: unknown[];
  log?: unknown;
  durationMs?: number;
  truncated?: boolean;
  manifest?: MaterializedExtensionManifest;
  translations?: unknown;
  language?: string;
  version?: string;
  runId?: number;
  params?: unknown;
  surfaceId?: string;
  definition?: Record<string, unknown>;
  tree?: unknown;
  replace?: boolean;
  callbackId?: number;
  requestId?: number;
  name?: string;
  priority?: number;
  kind?: string;
  cssText?: string;
  maxBytes?: number;
  title?: string;
  totalSteps?: number;
  message?: string;
  limits?: { maxTimers?: number; minIntervalMs?: number };
}

/** A declared UI surface and the tree cell its events redraw. */
interface Surface {
  readonly store: ValueCell<TreeState>;
  readonly dispose: () => void;
}

/** Returns an error's message, or the string form of a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalizes the log entries an iframe or worker sends across the bridge. */
function normalizeCellLogs(value: unknown): SandboxCellResult["logs"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const logs: SandboxCellResult["logs"][number][] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const log = entry as { level?: unknown; text?: unknown; atMs?: unknown };
    if (typeof log.text !== "string") {
      continue;
    }
    const level: SandboxCellResult["logs"][number]["level"] =
      log.level === "info" || log.level === "warn" || log.level === "error" ? log.level : "log";
    logs.push({
      level,
      text: log.text,
      atMs: typeof log.atMs === "number" ? log.atMs : 0,
    });
    if (logs.length >= MAX_CELL_LOGS) {
      break;
    }
  }
  return logs;
}

/** Serializes an error message, stable code, and structured details for the iframe. */
function describeError(error?: Error): { message: string; code?: string; details?: unknown } {
  const record = error as { code?: unknown; details?: unknown } | undefined;
  const code = record?.code;
  const details = record?.details;
  return {
    message: errorMessage(error),
    ...(typeof code === "string" ? { code } : {}),
    ...(details && typeof details === "object" ? { details } : {}),
  };
}

/** Adds the API path to a failure without losing its stable code or details. */
function withCallContext(label: string, error: unknown): Error {
  const wrapped = new Error(`${label}: ${errorMessage(error)}`, {
    cause: error instanceof Error ? error : undefined,
  }) as Error & { code?: string; capability?: string; details?: unknown };
  const record = error as { code?: unknown; capability?: unknown; details?: unknown } | undefined;
  if (typeof record?.code === "string") {
    wrapped.code = record.code;
  }
  if (typeof record?.capability === "string") {
    wrapped.capability = record.capability;
  }
  if (record?.details && typeof record.details === "object") {
    wrapped.details = record.details;
  }
  return wrapped;
}

/** Read the capability from one refused call without depending on its class. */
function deniedCapability(error: unknown): ExtensionCapability | null {
  const record = error as { code?: unknown; capability?: unknown } | undefined;
  return record?.code === "capabilityDenied" && typeof record.capability === "string"
    ? (record.capability as ExtensionCapability)
    : null;
}

/** Whether a result is a named-value handle that needs a bridge marker. */
function isValueHandle(value: unknown): value is ValueHandle<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const handle = value as Record<string, unknown>;
  return (
    typeof handle.id === "string" &&
    typeof handle.get === "function" &&
    typeof handle.set === "function" &&
    typeof handle.update === "function" &&
    typeof handle.subscribe === "function"
  );
}

/**
 * Rejects value definition callbacks: the bridge carries them as asynchronous
 * messages, while the registry calls `validate`, `merge`, and `equals` inline.
 */
function assertBridgedValueDefinition(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const definition = value as Record<string, unknown>;
  for (const key of ["initial", "validate", "merge", "equals"]) {
    if (typeof definition[key] === "function") {
      throw new Error(
        `Value definition option is not available inside the Extension sandbox: ${key}`,
      );
    }
  }
}

/** Keeps only plain style entries without `url()` references. */
function safeStyle(value: unknown): SandboxStyle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const style: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!STYLE_KEY.test(key) || (typeof entry !== "string" && typeof entry !== "number")) {
      continue;
    }
    if (typeof entry === "string" && /url\s*\(/iu.test(entry)) {
      continue;
    }
    style[key] = entry;
  }
  return Object.keys(style).length ? style : undefined;
}

/** Keeps only allowed attributes with primitive values. */
function safeAttrs(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ALLOWED_ATTRS.has(key)) {
      continue;
    }
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      attrs[key] = entry;
    }
  }
  return Object.keys(attrs).length ? attrs : undefined;
}

/** Validates one declared node against the tag, attribute, depth, and node budgets. */
function sanitizeNode(value: unknown, depth = 0, budget = { count: 0 }): SandboxUiNode | null {
  if (depth > MAX_UI_DEPTH || budget.count >= MAX_UI_NODES) {
    return null;
  }
  if (typeof value === "string") {
    budget.count += 1;
    return { kind: "text", text: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "text" && typeof record.text === "string") {
    budget.count += 1;
    return { kind: "text", text: record.text };
  }
  if (record.kind !== "element" || typeof record.tag !== "string") {
    return null;
  }
  if (!ALLOWED_TAGS.has(record.tag)) {
    return null;
  }
  budget.count += 1;
  const children: SandboxUiNode[] = [];
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const node = sanitizeNode(child, depth + 1, budget);
      if (node) {
        children.push(node);
      }
    }
  }
  const attrs = safeAttrs(record.attrs);
  if (record.tag === "input" && attrs?.type !== undefined) {
    if (typeof attrs.type !== "string" || !ALLOWED_INPUT_TYPES.has(attrs.type)) {
      delete attrs.type;
    }
  }
  return {
    kind: "element",
    tag: record.tag,
    ...(typeof record.id === "string" && record.id.length <= 128 ? { id: record.id } : {}),
    ...(typeof record.class === "string" && record.class.length <= 256
      ? { class: record.class }
      : {}),
    ...(safeStyle(record.style) ? { style: safeStyle(record.style) } : {}),
    ...(attrs ? { attrs } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(children.length ? { children } : {}),
  };
}

/** Sanitizes a declared tree and rejects an invalid root. */
function sanitizeTree(value: unknown): SandboxUiNode {
  const tree = sanitizeNode(value);
  if (!tree) {
    throw new Error("Extension UI tree is invalid or too large");
  }
  return tree;
}

/** Accepts only inline image data or blob URLs as an image source. */
function safeImageSource(value: unknown): string | undefined {
  return typeof value === "string" && IMAGE_SRC.test(value) ? value : undefined;
}

/** Controlled colour swatch for a sandbox declaration; the host owns the value. */
function SandboxColorInput({
  initial,
  onChange,
  ...props
}: {
  initial: string;
  onChange(value: string): void;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColorField
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

/** Renders one sanitized node as a React element, wiring its declared events. */
function renderNode(
  node: SandboxUiNode,
  index: number,
  onEvent: (event: SandboxUiEvent) => void,
  onPickImage?: (maxBytes: number) => Promise<SandboxPickedImage | null>,
): ReactNode {
  if (node.kind === "text") {
    return node.text;
  }
  const key = node.id ?? `${node.tag}:${index}`;
  if (node.tag === "img") {
    const src = safeImageSource(node.attrs?.src);
    return createElement("img", {
      key,
      className: node.class,
      style: node.style,
      src,
      alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "",
    });
  }
  const props: Record<string, unknown> = {
    key,
    className: node.class,
    style: node.style,
    "data-extension-node": node.id,
  };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (
      name === "src" ||
      name === "action" ||
      name === "maxBytes" ||
      name in props ||
      name === "checked" ||
      name === "value" ||
      name === "type"
    ) {
      continue;
    }
    props[name] = value;
  }
  if (node.tag === "option" && node.attrs?.value !== undefined) {
    props.value = String(node.attrs.value);
  }
  if (node.tag === "input") {
    const type =
      typeof node.attrs?.type === "string" && ALLOWED_INPUT_TYPES.has(node.attrs.type)
        ? node.attrs.type
        : "text";
    props.type = type;
    props.defaultValue = node.attrs?.value === undefined ? undefined : String(node.attrs.value);
    props.defaultChecked = node.attrs?.checked === true;
    props.onChange = (event: { currentTarget: HTMLInputElement }) => {
      const input = event.currentTarget;
      if (!node.id) {
        return;
      }
      onEvent({
        nodeId: node.id,
        kind: type === "checkbox" ? "change" : "input",
        value: input.value,
        checked: input.checked,
      });
    };
    if (type === "range") {
      return createElement(Slider, props);
    }
    if (type === "color") {
      return createElement(SandboxColorInput, {
        key,
        id: node.id,
        className: node.class,
        disabled: props.disabled === true,
        "aria-label": typeof props["aria-label"] === "string" ? props["aria-label"] : undefined,
        initial: String(node.attrs?.value ?? "#000000"),
        onChange: (next: string) => {
          if (node.id) {
            onEvent({ nodeId: node.id, kind: "input", value: next });
          }
        },
      });
    }
    // `input` is a void element; React rejects any child list, even an empty one.
    return createElement(Input, props);
  }
  if (node.tag === "select") {
    props.defaultValue = node.attrs?.value === undefined ? undefined : String(node.attrs.value);
    props.onChange = (event: { currentTarget: HTMLSelectElement }) => {
      if (!node.id) {
        return;
      }
      onEvent({ nodeId: node.id, kind: "change", value: event.currentTarget.value });
    };
  } else if (node.tag === "button") {
    props.type = "button";
    if (node.attrs?.action === "pick-image" && onPickImage) {
      props.onClick = () => {
        const maxBytes =
          typeof node.attrs?.maxBytes === "number"
            ? node.attrs.maxBytes
            : Number(node.attrs?.maxBytes) || MAX_IMAGE_BYTES;
        void onPickImage(maxBytes).then((picked) => {
          if (picked && node.id) {
            onEvent({ nodeId: node.id, kind: "file", file: picked });
          }
        });
      };
    } else {
      props.onClick = () => {
        if (node.id) {
          onEvent({ nodeId: node.id, kind: "click" });
        }
      };
    }
  }
  const children = (node.children ?? []).map((child, childIndex) =>
    renderNode(child, childIndex, onEvent, onPickImage),
  );
  if (node.text !== undefined) {
    children.push(node.text);
  }
  if (node.tag === "select") {
    return createElement(Select, props, children);
  }
  if (node.tag === "button") {
    return createElement(Button, { ...props, variant: "outlined" }, children);
  }
  return createElement(node.tag, props, children);
}

/** Subscribes to one surface tree and redraws the declaration. */
function SandboxTreeView({
  store,
  onEvent,
  onPickImage,
}: {
  store: ValueCell<TreeState>;
  onEvent: (event: SandboxUiEvent) => void;
  onPickImage?: (maxBytes: number) => Promise<SandboxPickedImage | null>;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return createElement(
    "div",
    {
      key: state.version,
      className: "extension-sandbox-content",
      "data-extension-tree-version": state.version,
    },
    renderNode(state.tree, 0, onEvent, onPickImage),
  );
}

/**
 * The frontend half of the sandbox. It owns the iframe, the message bridge, the
 * host UI roots, and the proxy registrations made through the host context.
 */
export function createExtensionSandbox(input: ExtensionSandboxFactoryInput): ExtensionSandboxHost {
  const token = crypto.randomUUID();
  const owner = input.manifest.id;
  const granted = new Set<ExtensionCapability>(input.manifest.capabilities ?? []);
  registerExtensionCapabilities(owner, granted);
  const pending = new Map<number, PendingRequest>();
  const pendingHooks = new Map<number, PendingHookRequest>();
  const pendingCallbacks = new Map<number, PendingRequest>();
  const disposers = new Map<string, () => void>();
  let nextId = 1;
  const valueHandles = createSandboxValueHandleTable(() => nextId++);
  const surfaces = new Map<string, Surface>();
  /** Per-surface update budgets; a burst coalesces into its newest tail frame. */
  const uiUpdateBudget = new SandboxUiUpdateBudget<SandboxUiNode>(owner);
  const progress = new Map<
    string,
    { update(message: string, options?: unknown): void; close(): void }
  >();
  let iframe: HTMLIFrameElement | null = null;
  let port: MessagePort | null = null;
  let disposed = false;
  let loading = true;
  let loadResolve: (() => void) | null = null;
  let loadReject: ((error: Error) => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  let readyCleanup: (() => void) | null = null;
  let readyTimer = 0;
  let loadTimer = 0;
  let chain: Promise<void> = Promise.resolve();
  const cellMode = input.mode === "cell";
  const cellTimeout = cellMode
    ? Math.min(
        CELL_MAX_TIMEOUT_MS,
        Math.max(
          1_000,
          typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
            ? Math.round(input.timeoutMs)
            : CELL_DEFAULT_TIMEOUT_MS,
        ),
      )
    : 0;
  let cellTimer = 0;
  let cellResolve: ((value: SandboxCellResult) => void) | null = null;
  let cellLogs: SandboxCellResult["logs"][number][] = [];
  const cellResult = cellMode
    ? new Promise<SandboxCellResult>((resolve) => {
        cellResolve = resolve;
      })
    : null;

  /** Reports a failure through the owning runtime. */
  const reportFailure = (error: unknown, action: string): void => {
    input.reportFailure(error instanceof Error ? error : new Error(errorMessage(error)), action);
  };

  /** Posts one message to the sandbox once the port is open. */
  const send = (message: unknown): void => {
    if (disposed || !port) {
      return;
    }
    port.postMessage(message);
  };

  /** Answers one RPC request with its value or error. */
  const respond = (id: number, ok: boolean, value?: unknown, error?: Error): void => {
    send({
      type: "rpc-result",
      id,
      ok,
      ...(ok ? { value } : { error: describeError(error) }),
    });
  };

  /** Rejects the pending load once, while activation is still running. */
  const failLoad = (error: unknown): void => {
    if (!loading) {
      return;
    }
    loading = false;
    loadReject?.(error instanceof Error ? error : new Error(errorMessage(error)));
  };

  /** Rejects the pending handshake once; a disposed iframe can never become ready. */
  const failReady = (error: Error): void => {
    const reject = readyReject;
    readyReject = null;
    readyCleanup?.();
    readyCleanup = null;
    reject?.(error);
  };

  /** Tears down the iframe, the bridge port, surfaces, and pending work. */
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    send({ type: "dispose" });
    disposed = true;
    loading = false;
    failReady(new Error("Extension sandbox was disposed"));
    window.clearTimeout(readyTimer);
    window.clearTimeout(loadTimer);
    window.clearTimeout(cellTimer);
    const settleCell = cellResolve;
    cellResolve = null;
    settleCell?.({
      ok: false,
      logs: [...cellLogs],
      error: { name: "AbortError", message: "Code cell sandbox was disposed" },
      durationMs: 0,
      truncated: false,
    });
    for (const request of pending.values()) {
      request.reject(new Error("Extension sandbox was disposed"));
    }
    pending.clear();
    for (const request of pendingHooks.values()) {
      request.reject(new Error("Extension sandbox was disposed"));
    }
    pendingHooks.clear();
    for (const request of pendingCallbacks.values()) {
      request.reject(new Error("Extension sandbox was disposed"));
    }
    pendingCallbacks.clear();
    for (const surface of surfaces.values()) {
      surface.dispose();
    }
    surfaces.clear();
    uiUpdateBudget.dispose();
    for (const handle of progress.values()) {
      handle.close();
    }
    progress.clear();
    valueHandles.clear();
    for (const disposeEntry of disposers.values()) {
      try {
        disposeEntry();
      } catch (error) {
        reportFailure(error, "sandbox.dispose");
      }
    }
    disposers.clear();
    try {
      port?.close();
    } catch {
      // The port may already be closed by the iframe teardown.
    }
    port = null;
    iframe?.remove();
    iframe = null;
    loadReject?.(new Error("Extension sandbox was disposed"));
    loadResolve = null;
    loadReject = null;
  };

  /** Asks the sandbox to run one registered script and awaits its result. */
  const runScript = async (runId: number, params: unknown): Promise<void> => {
    const requestId = nextId++;
    const result = await new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      send({
        type: "script-run",
        runId,
        requestId,
        params: cloneForSandbox(params),
      });
    });
    if (!result || result.ok !== true) {
      throw new Error(result?.error || "Extension script failed");
    }
  };

  /** Invoke one sandbox hook callback and await its JSON result. */
  const invokeSandboxHook = (callbackId: number, payload: unknown): Promise<unknown> => {
    const requestId = nextId++;
    return new Promise((resolve, reject) => {
      pendingHooks.set(requestId, { resolve, reject });
      send({
        type: "hook-call",
        requestId,
        callbackId,
        payload: cloneForSandbox(payload),
      });
    });
  };

  /** Invoke one sandbox callback and await its result for a service operation. */
  const invokeSandboxCallback = (
    callbackId: number,
    args: readonly unknown[],
  ): Promise<unknown> => {
    const requestId = nextId++;
    return new Promise((resolve, reject) => {
      pendingCallbacks.set(requestId, { resolve, reject });
      send({ type: "callback", id: callbackId, requestId, args: cloneForSandbox(args) });
    });
  };

  /** Resolves a bridged API path to its owning object and callable member. */
  const resolveApi = (
    path: unknown,
  ): { target: object; method: (...args: unknown[]) => unknown; label: string } => {
    if (!Array.isArray(path) || !path.length || path.length > 8) {
      throw new Error("Extension API path is invalid");
    }
    if (path.some((part) => typeof part !== "string" || BLOCKED_API_KEYS.has(part))) {
      throw new Error("Extension API path is invalid");
    }
    let target: unknown = input.context.api;
    for (const part of path.slice(0, -1)) {
      if (!target || (typeof target !== "object" && typeof target !== "function")) {
        throw new Error(`Extension API handle is unavailable: ${path.join(".")}`);
      }
      target = (target as Record<string, unknown>)[part];
    }
    if (!target || (typeof target !== "object" && typeof target !== "function")) {
      throw new Error(`Extension API handle is unavailable: ${path.join(".")}`);
    }
    const methodName = path[path.length - 1];
    const method = (target as Record<string, unknown>)[methodName];
    if (typeof method !== "function") {
      throw new Error(`Extension API member is not callable: ${path.join(".")}`);
    }
    const handleName = path[0] as string;
    const member = path.slice(1).join(".");
    if (!lookupMethod(handleName, member)) {
      throw new ExtensionMethodRegistrationError(path.join("."));
    }
    return {
      target: target as object,
      method: method as (...args: unknown[]) => unknown,
      label: path.join("."),
    };
  };

  /** Decodes bridged arguments, restoring byte payloads and callbacks. */
  const decodeArgs = (value: unknown): unknown =>
    decodeBridgeArgs(value, {
      callback: (id) => {
        return (...args: unknown[]) => {
          try {
            send({ type: "callback", id, args: cloneForSandbox(args) });
          } catch (error) {
            reportFailure(error, `sandbox.callback.${id}`);
          }
        };
      },
    });

  /** Encodes an API result, registering value handles and returned disposers. */
  const encodeResult = (value: unknown): unknown => {
    return encodeBridgeResult(value, {
      valueHandle: (candidate) =>
        isValueHandle(candidate) ? valueHandles.encode(candidate) : undefined,
      function: (candidate) => {
        const id = `disposer:${nextId++}`;
        disposers.set(id, candidate as () => void);
        return { __disposer: id };
      },
    });
  };

  /** Resolves a value handle marker issued by this sandbox. */
  const requireValueHandle = (id: unknown) => valueHandles.require(id);

  /** Decodes a bridged callback argument and rejects a non-function payload. */
  const requireBridgedCallback = (
    value: unknown,
    label: string,
  ): ((...args: unknown[]) => void) => {
    const callback = decodeArgs(value);
    if (typeof callback !== "function") {
      throw new Error(`${label} requires a callback`);
    }
    return callback as (...args: unknown[]) => void;
  };

  /** Invokes one host API method on behalf of the sandbox. */
  const callApi = async (args: unknown[]): Promise<unknown> => {
    const [path, callArgs] = args;
    let label = Array.isArray(path) ? path.join(".") : "api.call";
    try {
      const resolved = resolveApi(path);
      label = resolved.label;
      const decoded = Array.isArray(callArgs) ? (decodeArgs(callArgs) as unknown[]) : [];
      if (
        Array.isArray(path) &&
        path.length === 2 &&
        path[0] === "values" &&
        path[1] === "define"
      ) {
        assertBridgedValueDefinition(decoded[0]);
      }
      const result = await resolved.method.apply(resolved.target, decoded);
      return encodeResult(result);
    } catch (error) {
      const denied = deniedCapability(error);
      if (denied) {
        logExtensionCapabilityDenial(owner, denied, label);
      }
      throw withCallContext(label, error);
    }
  };

  /** Registers a declared panel or overlay surface and keeps its tree cell. */
  const registerSurface = (
    kind: "panel" | "overlay",
    payload: { surfaceId?: unknown; definition?: Record<string, unknown> },
  ): void => {
    const surfaceId = typeof payload.surfaceId === "string" ? payload.surfaceId : "";
    if (!surfaceId || surfaces.has(surfaceId)) {
      throw new Error("Extension UI surface id is invalid or already registered");
    }
    const definition = payload.definition;
    if (!definition || typeof definition.id !== "string" || !definition.id.trim()) {
      throw new Error("Extension UI surface id must be non-empty");
    }
    const tree = sanitizeTree(definition.tree);
    const eventId = typeof definition.eventId === "number" ? definition.eventId : undefined;
    const store = createValue<TreeState>({ initial: { tree, version: 0 } });
    /** Forwards a rendered UI event to the sandbox callback that declared it. */
    const dispatch = (event: SandboxUiEvent): void => {
      if (eventId !== undefined) {
        send({ type: "callback", id: eventId, args: [event] });
      }
    };
    let disposeSurface: () => void;
    if (kind === "panel") {
      const component = () =>
        createElement(SandboxTreeView, { store, onEvent: dispatch, onPickImage: pickImage });
      disposeSurface = input.context.ui.registerPanel({
        id: definition.id,
        component,
      });
    } else {
      const order = typeof definition.order === "number" ? definition.order : undefined;
      const scope = definition.scope === "window" ? "window" : "stage";
      let root: Root | null = null;
      let stopped = false;
      disposeSurface = input.context.ui.registerOverlay({
        id: definition.id,
        ...(order === undefined ? {} : { order }),
        scope,
        mount(layer, signal) {
          root = createRoot(layer);
          const render = () => {
            root?.render(
              createElement(SandboxTreeView, {
                store,
                onEvent: dispatch,
                onPickImage: pickImage,
              }),
            );
          };
          const unsubscribe = store.subscribe(render);
          const stop = () => {
            if (stopped) {
              return;
            }
            stopped = true;
            unsubscribe();
            root?.unmount();
            root = null;
          };
          signal.addEventListener("abort", stop, { once: true });
          render();
          return stop;
        },
      });
    }
    surfaces.set(surfaceId, { store, dispose: disposeSurface });
  };

  /** Opens an image picker for the sandbox and returns the selection within its byte limit. */
  const pickImage = (maxBytes: number): Promise<SandboxPickedImage | null> => {
    return new Promise((resolve) => {
      if (!granted.has("ui.dialog")) {
        resolve(null);
        return;
      }
      const limit = Math.min(MAX_IMAGE_BYTES, Math.max(1, Math.floor(maxBytes) || MAX_IMAGE_BYTES));
      const element = document.createElement("input");
      element.type = "file";
      element.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
      element.style.cssText = "position:fixed;left:-10000px;top:-10000px";
      document.body.append(element);
      let settled = false;
      /** Settles the picker once and removes the temporary input. */
      const finish = (value: SandboxPickedImage | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        element.remove();
        resolve(value);
      };
      element.addEventListener(
        "change",
        () => {
          const file = element.files?.[0];
          if (!file || file.size > limit || !file.type.startsWith("image/")) {
            finish(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            finish({
              name: file.name,
              type: file.type,
              dataUrl: String(reader.result ?? ""),
            });
          reader.onerror = () => finish(null);
          reader.readAsDataURL(file);
        },
        { once: true },
      );
      element.addEventListener("cancel", () => finish(null), { once: true });
      element.click();
    });
  };

  /** Dispatches one bridged method to its host capability. */
  const dispatchRpc = async (message: SandboxPayload): Promise<unknown> => {
    const method = message.method ?? "";
    if (cellMode && method !== "api.call") {
      throw new Error(`Code cell sandbox only permits api.call: ${method}`);
    }
    const args = Array.isArray(message.args) ? message.args : [];
    switch (method) {
      case "api.call":
        return callApi(args);
      case "values.get":
        return cloneForSandbox(requireValueHandle(args[0]).get());
      case "values.set":
        requireValueHandle(args[0]).set(decodeArgs(args[1]));
        return undefined;
      case "values.update":
        requireValueHandle(args[0]).update(decodeArgs(args[1]) as Partial<unknown>);
        return undefined;
      case "values.subscribe": {
        const listener = requireBridgedCallback(args[1], "Value subscription");
        return encodeResult(requireValueHandle(args[0]).subscribe(listener));
      }
      case "values.release":
      case "values.delete":
        valueHandles.release(args[0]);
        return undefined;
      case "timers.setTimeout":
        return input.context.timers.setTimeout(
          requireBridgedCallback(args[0], "Timer callback"),
          typeof args[1] === "number" ? args[1] : 0,
        );
      case "timers.setInterval":
        return input.context.timers.setInterval(
          requireBridgedCallback(args[0], "Interval callback"),
          typeof args[1] === "number" ? args[1] : 0,
        );
      case "timers.requestAnimationFrame":
        return input.context.timers.requestAnimationFrame(
          requireBridgedCallback(args[0], "Animation-frame callback"),
        );
      case "timers.clearTimeout":
        input.context.timers.clearTimeout?.(args[0] as ReturnType<typeof globalThis.setTimeout>);
        return undefined;
      case "timers.clearInterval":
        input.context.timers.clearInterval?.(args[0] as ReturnType<typeof globalThis.setInterval>);
        return undefined;
      case "timers.cancelAnimationFrame":
        input.context.timers.cancelAnimationFrame(Number(args[0]));
        return undefined;
      case "ui.notice":
        input.context.ui.notice(
          args[0] as ExtensionText,
          args[1] as Record<string, unknown> | undefined,
        );
        return undefined;
      case "ui.confirm":
        return input.context.ui.confirm(args[0] as ExtensionText);
      case "ui.input":
        return input.context.ui.input(args[0] as Parameters<ScriptUiContext["input"]>[0]);
      case "ui.select":
        return input.context.ui.select(args[0] as Parameters<ScriptUiContext["select"]>[0]);
      case "ui.guide":
        return input.context.ui.guide(args[0] as Parameters<ScriptUiContext["guide"]>[0]);
      case "ui.progress": {
        const handle = input.context.ui.progress(
          args[0] as ExtensionText,
          typeof args[1] === "number" ? args[1] : undefined,
        );
        const id = `progress:${nextId++}`;
        progress.set(id, {
          update: (message, options) =>
            handle.update(message, options as Parameters<typeof handle.update>[1]),
          close: handle.close,
        });
        return id;
      }
      case "ui.progress.update": {
        const handle = progress.get(String(args[0]));
        handle?.update(String(args[1] ?? ""), args[2]);
        return undefined;
      }
      case "ui.progress.close":
        progress.get(String(args[0]))?.close();
        progress.delete(String(args[0]));
        return undefined;
      case "ui.pickImage":
        return pickImage(
          typeof (args[0] as { maxBytes?: unknown } | undefined)?.maxBytes === "number"
            ? (args[0] as { maxBytes: number }).maxBytes
            : MAX_IMAGE_BYTES,
        );
      case "ui.designCatalog":
        return input.context.ui.designCatalog();
      case "ui.registerDesignPanel": {
        const payload = args[0] as {
          surfaceId?: unknown;
          definition?: Record<string, unknown>;
        };
        const surfaceId = typeof payload?.surfaceId === "string" ? payload.surfaceId : "";
        const definition = payload?.definition;
        if (!surfaceId || !definition) {
          throw new Error("Extension design panel definition is invalid");
        }
        const eventId = typeof definition.eventId === "number" ? definition.eventId : undefined;
        const onEvent =
          eventId === undefined
            ? undefined
            : (event: ExtensionDesignEvent) => {
                send({ type: "callback", id: eventId, args: [event] });
              };
        const dispose = input.context.ui.registerDesignPanel({
          id: definition.id as string,
          slot: definition.slot as ExtensionDesignPanelDefinition["slot"],
          component: definition.component as ExtensionDesignPanelDefinition["component"],
          onEvent,
        });
        disposers.set(surfaceId, dispose);
        return undefined;
      }
      case "ui.registerPanel":
        registerSurface(
          "panel",
          args[0] as { surfaceId?: string; definition?: Record<string, unknown> },
        );
        return undefined;
      case "ui.registerOverlay":
        registerSurface(
          "overlay",
          args[0] as { surfaceId?: string; definition?: Record<string, unknown> },
        );
        return undefined;
      case "ui.update": {
        const payload = args[0] as { surfaceId?: unknown; tree?: unknown; replace?: unknown };
        const surfaceId = String(payload?.surfaceId);
        const surface = surfaces.get(surfaceId);
        if (!surface) {
          throw new Error("Extension UI surface is not registered");
        }
        const admission = uiUpdateBudget.submit(
          surfaceId,
          {
            tree: sanitizeTree(payload?.tree),
            replace: payload?.replace === true,
          },
          (update) => {
            const current = surface.store.get();
            surface.store.set({
              tree: update.tree,
              version: current.version + (update.replace ? 1 : 0),
            });
          },
        );
        if (admission.dropped && admission.surfaceDropped === 1) {
          console.warn(
            "[redux.extensions] ui.update rate budget exceeded; keeping the tail frame",
            {
              extension: owner,
              surface: surfaceId,
              steadyHz: UI_UPDATE_STEADY_HZ,
              burst: UI_UPDATE_BURST,
            },
          );
        }
        return undefined;
      }
      case "ui.remove": {
        const surfaceId = String((args[0] as { surfaceId?: unknown })?.surfaceId);
        const surface = surfaces.get(surfaceId);
        surface?.dispose();
        surfaces.delete(surfaceId);
        uiUpdateBudget.release(surfaceId);
        return undefined;
      }
      case "ui.registerSidebar": {
        const payload = args[0] as { surfaceId?: unknown; definition?: Record<string, unknown> };
        const localId = typeof payload?.surfaceId === "string" ? payload.surfaceId : "";
        if (!localId || !payload.definition) {
          throw new Error("Extension sidebar definition is invalid");
        }
        disposers.set(
          localId,
          input.context.ui.registerSidebar(
            payload.definition as unknown as Parameters<ScriptUiContext["registerSidebar"]>[0],
          ),
        );
        return undefined;
      }
      case "scripts.register": {
        const localId = String(args[0]);
        const metadata = args[1] as {
          id?: unknown;
          label?: unknown;
          description?: unknown;
          icon?: unknown;
          defaultShortcuts?: unknown;
          parameters?: unknown;
          steps?: unknown;
          runId?: unknown;
        };
        if (!metadata || typeof metadata.id !== "string" || !metadata.id.trim()) {
          throw new Error("Extension script id must be non-empty");
        }
        const defaultShortcuts = Array.isArray(metadata.defaultShortcuts)
          ? (metadata.defaultShortcuts as ExtensionScriptDefinition["defaultShortcuts"])
          : undefined;
        const allowedShortcuts = grantScriptDefaultShortcuts(
          owner,
          metadata.id,
          defaultShortcuts,
          granted,
        );
        const definition: ExtensionScriptDefinition = {
          id: metadata.id,
          label: metadata.label as string,
          ...(metadata.description === undefined
            ? {}
            : { description: metadata.description as string }),
          ...(typeof metadata.icon === "string" ? { icon: metadata.icon } : {}),
          ...(allowedShortcuts ? { defaultShortcuts: allowedShortcuts } : {}),
          ...(metadata.parameters
            ? { parameters: metadata.parameters as ExtensionParameterSchema }
            : {}),
          ...(Array.isArray(metadata.steps)
            ? { steps: metadata.steps as readonly ExtensionScriptStep[] }
            : {}),
          ...(typeof metadata.runId === "number"
            ? {
                run: async (scriptContext) => {
                  await runScript(metadata.runId as number, scriptContext.params);
                },
              }
            : {}),
        };
        disposers.set(localId, input.context.scripts.register(definition));
        return undefined;
      }
      case "events.on": {
        const localId = String(args[0]);
        const name = String(args[1]);
        const callbackId = Number(args[2]);
        const priority = typeof args[3] === "number" ? args[3] : 0;
        disposers.set(
          localId,
          input.context.events.on(
            name,
            (payload) => {
              try {
                send({
                  type: "callback",
                  id: callbackId,
                  args: [cloneForSandbox(projectExtensionEventPayload(name, payload, granted))],
                });
              } catch (error) {
                reportFailure(error, `sandbox.event.${name}`);
              }
            },
            priority,
          ),
        );
        return undefined;
      }
      case "hooks.register": {
        const localId = String(args[0]);
        const name = String(args[1]);
        const callbackId = Number(args[2]);
        const priority = typeof args[3] === "number" ? args[3] : 0;
        const schema = args[4] as PublicHookPayloadSchema;
        disposers.set(
          localId,
          input.context.hooks.register(
            name,
            (payload) =>
              invokeSandboxHook(callbackId, payload) as Promise<Record<string, unknown> | void>,
            schema,
            priority,
          ),
        );
        return undefined;
      }
      case "hooks.invoke":
        return input.context.hooks.invoke(
          String(args[0]),
          decodeArgs(args[1]),
          typeof args[2] === "object" && args[2] !== null
            ? (args[2] as { timeoutMs?: number })
            : undefined,
        );
      case "services.provide": {
        const localId = String(args[0]);
        const payload = args[1] as { id?: unknown; version?: unknown; methods?: unknown };
        const callbackIds = args[2] as Record<string, unknown>;
        if (
          !payload ||
          typeof payload.id !== "string" ||
          typeof payload.version !== "string" ||
          !callbackIds ||
          typeof callbackIds !== "object"
        ) {
          throw new Error("Extension service definition is invalid");
        }
        const methods: Record<string, (...values: readonly unknown[]) => Promise<unknown>> = {};
        for (const [name, value] of Object.entries(callbackIds)) {
          const callbackId = Number(value);
          if (!Number.isSafeInteger(callbackId)) {
            throw new Error(`Extension service callback is invalid: ${name}`);
          }
          methods[name] = (...values) => invokeSandboxCallback(callbackId, values);
        }
        disposers.set(
          localId,
          input.context.services.provide({
            id: payload.id,
            version: payload.version,
            methods,
          }),
        );
        return undefined;
      }
      case "services.resolve":
        return input.context.services.resolve(
          String(args[0]),
          typeof args[1] === "string" ? args[1] : undefined,
        );
      case "services.call":
        return input.context.services.call(
          String(args[0]),
          String(args[1]),
          Array.isArray(args[2]) ? (decodeArgs(args[2]) as readonly unknown[]) : [],
        );
      case "services.onChange": {
        const localId = String(args[0]);
        const serviceId = String(args[1]);
        const callbackId = Number(args[2]);
        if (!Number.isSafeInteger(callbackId)) {
          throw new Error("Extension service listener is invalid");
        }
        disposers.set(
          localId,
          input.context.services.onChange(serviceId, (info: ExtensionServiceInfo | null) => {
            send({ type: "callback", id: callbackId, args: [cloneForSandbox(info)] });
          }),
        );
        return undefined;
      }
      case "services.provideData": {
        const localId = String(args[0]);
        const payload = args[1] as { id?: unknown; version?: unknown; initial?: unknown };
        if (!payload || typeof payload.id !== "string" || typeof payload.version !== "string") {
          throw new Error("Extension data provider definition is invalid");
        }
        disposers.set(
          localId,
          input.context.services.provideData({
            id: payload.id,
            version: payload.version,
            initial: decodeArgs(payload.initial),
          }),
        );
        return undefined;
      }
      case "services.readData":
        return input.context.services.readData(
          String(args[0]),
          typeof args[1] === "string" ? args[1] : undefined,
        );
      case "services.updateData":
        input.context.services.updateData(String(args[0]), decodeArgs(args[1]));
        return undefined;
      case "services.onDataChange": {
        const localId = String(args[0]);
        const providerId = String(args[1]);
        const callbackId = Number(args[2]);
        if (!Number.isSafeInteger(callbackId)) {
          throw new Error("Extension data listener is invalid");
        }
        disposers.set(
          localId,
          input.context.services.onDataChange(providerId, (info: ExtensionDataInfo | null) => {
            send({ type: "callback", id: callbackId, args: [cloneForSandbox(info)] });
          }),
        );
        return undefined;
      }
      case "store.get":
        return (args[0] === "storage" ? input.context.storage : input.context.settings).get(
          String(args[1]),
        );
      case "store.getJSON":
        if (args[0] !== "storage") {
          throw new Error("JSON storage methods are only available on context.storage");
        }
        return input.context.storage.getJSON(String(args[1]));
      case "store.set":
        (args[0] === "storage" ? input.context.storage : input.context.settings).set(
          String(args[1]),
          String(args[2]),
        );
        return undefined;
      case "store.setJSON":
        if (args[0] !== "storage") {
          throw new Error("JSON storage methods are only available on context.storage");
        }
        input.context.storage.setJSON(String(args[1]), decodeArgs(args[2]));
        return undefined;
      case "store.delete":
        (args[0] === "storage" ? input.context.storage : input.context.settings).delete(
          String(args[1]),
        );
        return undefined;
      case "store.clear":
        (args[0] === "storage" ? input.context.storage : input.context.settings).clear();
        return undefined;
      case "styles.add": {
        const localId = String(args[0]);
        disposers.set(localId, input.context.styles.add(String(args[1])));
        return undefined;
      }
      default:
        throw new Error(`Unknown Extension sandbox method: ${method}`);
    }
  };

  /** The capability one bridge method exercises, or null when the gate records it. */
  const rpcCapability = (method: string, args: unknown[]): ExtensionCapability | null => {
    if (method === "api.call") {
      return null;
    }
    if (method.startsWith("values.")) {
      return "values";
    }
    if (method.startsWith("timers.")) {
      return "timers";
    }
    if (method === "scripts.register") {
      return "scripts";
    }
    if (method === "events.on") {
      return "events";
    }
    if (method === "hooks.register" || method === "hooks.invoke") {
      return "hooks";
    }
    if (method.startsWith("services.")) {
      return "services";
    }
    if (method === "styles.add") {
      return "styles";
    }
    if (method.startsWith("store.")) {
      return args[0] === "storage" ? "storage" : "settings";
    }
    switch (method) {
      case "ui.notice":
      case "ui.progress":
      case "ui.progress.update":
      case "ui.progress.close":
        return "ui.notice";
      case "ui.confirm":
      case "ui.input":
      case "ui.select":
      case "ui.guide":
      case "ui.pickImage":
        return "ui.dialog";
      case "ui.designCatalog":
      case "ui.registerDesignPanel":
        return "ui.panel";
      case "ui.registerPanel":
        return "ui.panel";
      case "ui.registerOverlay":
        return "ui.overlay";
      case "ui.registerSidebar":
        return "ui.sidebar";
      default:
        return null;
    }
  };

  /** Dispatches one bridge method and records its capability outcome. */
  const handleRpc = async (message: SandboxPayload): Promise<unknown> => {
    const method = message.method ?? "";
    const args = Array.isArray(message.args) ? message.args : [];
    const capability = rpcCapability(method, args);
    try {
      const result = await dispatchRpc(message);
      if (capability !== null) {
        recordExtensionCapability(owner, capability, "used");
      }
      return result;
    } catch (error) {
      if (method !== "api.call") {
        const denied = deniedCapability(error);
        if (denied !== null) {
          recordExtensionCapability(owner, denied, "denied");
        }
      }
      throw error;
    }
  };

  /** Routes one inbound port message by type. */
  const handleMessage = async (message: SandboxPayload): Promise<void> => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "failure") {
      const detail =
        typeof message.error === "string"
          ? message.error
          : message.error?.message || "Extension sandbox failure";
      reportFailure(new Error(detail), message.action ?? "sandbox");
      return;
    }
    if (message.type === "dispose-handle") {
      const id = String(message.id);
      const disposeEntry = disposers.get(id);
      if (disposeEntry) {
        disposers.delete(id);
        disposeEntry();
      }
      return;
    }
    if (message.type === "cell-log") {
      const [entry] = normalizeCellLogs([message.log]);
      if (entry && cellLogs.length < MAX_CELL_LOGS) {
        cellLogs.push(entry);
      }
      return;
    }
    if (message.type === "cell-result") {
      window.clearTimeout(cellTimer);
      const logs = normalizeCellLogs(message.logs);
      const error =
        message.error && typeof message.error === "object"
          ? {
              ...(typeof message.error.name === "string" ? { name: message.error.name } : {}),
              message:
                typeof message.error.message === "string"
                  ? message.error.message
                  : "Code cell failed",
              ...(typeof message.error.stack === "string" ? { stack: message.error.stack } : {}),
            }
          : undefined;
      const resolve = cellResolve;
      cellResolve = null;
      resolve?.({
        ok: message.ok === true,
        ...(message.ok === true ? { value: message.value } : {}),
        logs,
        ...(error ? { error } : {}),
        durationMs: typeof message.durationMs === "number" ? message.durationMs : 0,
        truncated: message.truncated === true,
      });
      return;
    }
    if (message.type === "loaded") {
      if (message.ok === true) {
        loading = false;
        window.clearTimeout(loadTimer);
        loadResolve?.();
      } else {
        failLoad(
          new Error(
            typeof message.error === "string" ? message.error : "Extension activation failed",
          ),
        );
      }
      return;
    }
    if (message.type === "script-result") {
      const requestId = Number(message.requestId);
      const request = pending.get(requestId);
      if (request) {
        pending.delete(requestId);
        request.resolve({
          ok: message.ok === true,
          error: typeof message.error === "string" ? message.error : undefined,
        });
      }
      return;
    }
    if (message.type === "hook-result") {
      const requestId = Number(message.requestId);
      const request = pendingHooks.get(requestId);
      if (!request) {
        return;
      }
      pendingHooks.delete(requestId);
      if (message.ok === true) {
        request.resolve(message.value);
      } else {
        request.reject(
          new Error(
            typeof message.error === "string" ? message.error : "Extension hook callback failed",
          ),
        );
      }
      return;
    }
    if (message.type === "callback-result") {
      const request = pendingCallbacks.get(Number(message.requestId));
      if (!request) {
        return;
      }
      pendingCallbacks.delete(Number(message.requestId));
      if (message.ok === true) {
        request.resolve(message.value);
      } else {
        const detail =
          typeof message.error === "object" && message.error !== null
            ? message.error.message
            : message.error;
        request.reject(
          new Error(typeof detail === "string" ? detail : "Extension callback failed"),
        );
      }
      return;
    }
    if (message.type === "notify") {
      try {
        await handleRpc(message);
      } catch (error) {
        reportFailure(error, `sandbox.${message.method ?? "notify"}`);
      }
      return;
    }
    if (message.type !== "rpc") {
      return;
    }
    const id = Number(message.id);
    try {
      const result = await handleRpc(message);
      respond(id, true, result);
    } catch (error) {
      if (loading) {
        failLoad(error);
      }
      respond(
        id,
        false,
        undefined,
        error instanceof Error ? error : new Error(errorMessage(error)),
      );
    }
  };

  /** Creates the iframe, waits for its ready handshake, then loads the package. */
  const start = async (): Promise<void> => {
    if (disposed) {
      throw new Error("Extension sandbox was disposed");
    }
    cellLogs = [];
    const loaded = cellMode
      ? null
      : new Promise<void>((resolve, reject) => {
          loadResolve = resolve;
          loadReject = reject;
        });
    // Attach the rejection handler before awaiting, so an early teardown is not
    // reported as unhandled.
    if (loaded) {
      void loaded.catch(() => {});
    }
    const element = document.createElement("iframe");
    element.dataset.extensionSandbox = input.manifest.id;
    element.setAttribute("sandbox", "allow-scripts");
    element.setAttribute(
      "allow",
      "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
    );
    element.referrerPolicy = "no-referrer";
    element.setAttribute("aria-hidden", "true");
    element.tabIndex = -1;
    element.style.cssText =
      "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-10000px;top:-10000px";
    element.title = `Extension sandbox: ${input.manifest.id}`;
    iframe = element;
    // A package that navigates the frame would replace the bootstrap document
    // with one that never runs the IPC shield. The first load is the bootstrap;
    // any later load is an unexpected navigation and tears the sandbox down.
    let initialLoad = true;
    element.addEventListener("load", () => {
      if (initialLoad) {
        initialLoad = false;
        return;
      }
      const error = new Error("Extension sandbox navigated away from its bootstrap");
      reportFailure(error, "sandbox.navigate");
      failLoad(error);
      dispose();
    });
    const source = new URL("extension-sandbox.html", document.baseURI);
    source.searchParams.set("token", token);
    const readyTimeout = cellMode
      ? Math.min(SANDBOX_READY_TIMEOUT_MS, cellTimeout + HOST_CELL_FALLBACK_GRACE_MS)
      : SANDBOX_READY_TIMEOUT_MS;
    const ready = new Promise<void>((resolve, reject) => {
      /** Settles the handshake and releases its listener and timer exactly once. */
      const finish = (error?: Error): void => {
        readyReject = null;
        readyCleanup?.();
        readyCleanup = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      readyReject = finish;
      /** Resolves the handshake when this iframe, with this token, reports ready. */
      const onReady = (event: MessageEvent) => {
        if (
          event.source !== element.contentWindow ||
          event.data?.type !== "redux-sandbox-ready" ||
          event.data?.token !== token
        ) {
          return;
        }
        finish();
      };
      window.addEventListener("message", onReady);
      readyCleanup = () => {
        window.removeEventListener("message", onReady);
        window.clearTimeout(readyTimer);
      };
      readyTimer = window.setTimeout(() => {
        const error = new Error("Extension sandbox did not become ready");
        if (cellMode) {
          error.name = "TimeoutError";
        }
        finish(error);
      }, readyTimeout);
    });
    element.src = source.href;
    document.body.append(element);
    try {
      await ready;
      window.clearTimeout(readyTimer);
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event) => {
        chain = chain
          .then(() => handleMessage(event.data as SandboxPayload))
          .catch((error) => reportFailure(error, "sandbox.message"));
      };
      port.start();
      element.contentWindow?.postMessage({ type: "redux-sandbox-init", token }, "*", [
        channel.port2,
      ]);
      if (cellMode) {
        cellTimer = window.setTimeout(
          () => {
            const resolve = cellResolve;
            cellResolve = null;
            resolve?.({
              ok: false,
              logs: [...cellLogs],
              error: {
                name: "TimeoutError",
                message: `Code cell execution timed out after ${cellTimeout} ms`,
              },
              durationMs: cellTimeout,
              truncated: true,
            });
            dispose();
          },
          Math.min(CELL_MAX_TIMEOUT_MS, cellTimeout + HOST_CELL_FALLBACK_GRACE_MS),
        );
      } else {
        loadTimer = window.setTimeout(() => {
          failLoad(new Error("Extension sandbox activation timed out"));
        }, SANDBOX_LOAD_TIMEOUT_MS);
      }
      send({
        type: "load",
        source: input.source,
        ...(cellMode ? { workerSource: CELL_WORKER_SOURCE } : {}),
        manifest: input.manifest,
        translations: input.translations,
        language: getLanguage(),
        version: BUILD_APP_VERSION,
        capabilities: input.manifest.capabilities ?? [],
        limits: EXTENSION_TIMER_LIMITS,
        ...(cellMode ? { mode: "cell", input: input.input, timeoutMs: cellTimeout } : {}),
      });
      if (cellMode) {
        loading = false;
        return;
      }
      await loaded;
    } catch (error) {
      dispose();
      throw error;
    }
  };

  return {
    start,
    dispose,
    ...(cellMode && cellResult ? { runCell: () => cellResult } : {}),
  };
}
