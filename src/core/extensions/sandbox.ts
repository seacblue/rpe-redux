/**
 * The sandbox-facing Extension contract.
 *
 * A sandboxed package receives asynchronous mirrors of the host handles and a
 * declarative UI tree; it never receives the host DOM. Code runs in an
 * opaque-origin iframe, and these types are the only values that cross the
 * message bridge.
 */
import type { ReduxApi } from "../api/index.ts";
import type { ApiResult } from "../api/contract.ts";
import type { SettingsApi } from "../api/settings.ts";
import type { ExtensionThemeTokens } from "../api/theme.ts";
import type {
  ChartReadAllOptions,
  ChartReadCollection,
  ChartReadItem,
  ChartReadPage,
  ChartReadPageOptions,
} from "../edit/chart/api.ts";
import type { Shortcut, ShortcutScope } from "../shortcuts/types.ts";
import type { AssetInfo } from "./assets.ts";
import type { ExtensionCapability } from "./capabilities.ts";
import type {
  PublicHookInvokeOptions,
  PublicHookInvocationResult,
  PublicHookPayloadSchema,
} from "./publicHooks.ts";
import type {
  ExtensionDataInfo,
  ExtensionDataProviderDefinition,
  ExtensionServiceDefinition,
  ExtensionServiceInfo,
} from "./serviceRegistry.ts";
import type { ExtensionParameterSchema } from "./parameters.ts";
import type { ExtensionScriptStep } from "./steps.ts";
import type { ExtensionI18n, ExtensionText, ExtensionTranslations } from "./i18n.ts";
import type {
  ExtensionAssetResolver,
  ExtensionHostContext,
  MaterializedExtensionManifest,
  TrustedExtensionManifest,
} from "./extensionContract.ts";
import type {
  ExtensionDesignCatalog,
  ExtensionDesignEvent,
  ExtensionDesignPanelDefinition,
} from "./designComponents.ts";

/** Every call crosses the bridge, so results arrive as promises. */
export type AsyncApi<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { readonly [K in keyof T]: AsyncApi<T[K]> }
      : T;

/**
 * Async chart reads keep their collection literal.
 *
 * `AsyncApi` cannot map a generic signature, so the generic read methods are
 * restated here; otherwise `readAll("timing")` would widen to every item type.
 */
type AsyncChartApi<T> = Omit<AsyncApi<T>, "read" | "readAll"> & {
  read<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadPageOptions,
  ): Promise<ApiResult<ChartReadPage<ChartReadItem<Collection>>>>;
  readAll<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadAllOptions,
  ): Promise<ApiResult<readonly ChartReadItem<Collection>[]>>;
};

/** Host-only handles that never cross the package bridge. */
type HostOnlyHandle = "settings" | "workspace" | "extensions";

/** The full host handles a sandbox can see, including host-tool-only operations. */
type FullSandboxHostApi = Omit<ReduxApi, HostOnlyHandle | "theme"> & {
  readonly settings: SettingsApi;
  /**
   * Token reads become promises like every other bridged call. The subscription
   * returns no disposer: its lifetime is the activation.
   */
  readonly theme: {
    tokens(): ExtensionThemeTokens;
    subscribe(listener: () => void): void;
  };
};

/** Chart reads a package may use; whole-chart and duplicate helpers stay host-only. */
type PackageChartApi = Omit<
  ReduxApi["chart"],
  "snapshot" | "metadata" | "lines" | "notes" | "events"
>;

/** Transport controls stay; renderer inspection and metric capture stay host-only. */
type PackagePlaybackApi = Omit<
  ReduxApi["playback"],
  | "replay"
  | "inspect"
  | "renderAt"
  | "textures"
  | "frames"
  | "startMeasurement"
  | "stopMeasurement"
  | "metrics"
  | "resetDiagnostics"
>;

/** Contribution registration and lookup stay; host refresh/introspection stay inside. */
type PackageToolbarApi = Omit<
  ReduxApi["toolbar"],
  "refresh" | "available" | "bindings" | "shortcutText"
>;

/** Named values stay; broad snapshots and cross-package subscriptions do not. */
type PackageValuesApi = Omit<ReduxApi["values"], "getHandle" | "byId"> & {
  readonly byId: Omit<ReduxApi["values"]["byId"], "subscribeAll" | "snapshot">;
};

/** Only the redacted snapshot is published to packages. */
type PackageDiagnosticsApi = Omit<ReduxApi["diagnostics"], "trace">;

/** Geometry and renderer frames remain host inspection surfaces. */
type PackageHitTestApi = Omit<ReduxApi["hitTest"], "geometry">;
type PackagePreviewApi = Omit<ReduxApi["preview"], "frame">;

/** Host navigation stays host-owned; packages may register tutorials only. */
type PackageHelpApi = Omit<ReduxApi["help"], "openChangelog" | "openGuide">;

/** The narrow package facade; `methodRegistry.ts` lists exactly these paths. */
type SandboxHostApi = Omit<
  FullSandboxHostApi,
  | "chart"
  | "playback"
  | "toolbar"
  | "values"
  | "diagnostics"
  | "hitTest"
  | "preview"
  | "layout"
  | "help"
> & {
  readonly chart: PackageChartApi;
  readonly playback: PackagePlaybackApi;
  readonly toolbar: PackageToolbarApi;
  readonly values: PackageValuesApi;
  readonly diagnostics: PackageDiagnosticsApi;
  readonly hitTest: PackageHitTestApi;
  readonly preview: PackagePreviewApi;
  readonly help: PackageHelpApi;
};

/** The asynchronous `redux` facade available inside the package sandbox. */
export type SandboxReduxApi = AsyncApi<Omit<SandboxHostApi, "chart">> & {
  readonly chart: AsyncChartApi<PackageChartApi>;
};

/** Code cells keep the full host inspection surface plus the explicit grant list. */
export type SandboxCodeCellApi = AsyncApi<
  Omit<FullSandboxHostApi, "chart"> & { capabilities(): readonly ExtensionCapability[] }
> & {
  readonly chart: AsyncChartApi<FullSandboxHostApi["chart"]>;
};

/** A CSS declaration set. Custom properties are allowed. */
export type SandboxStyle = Readonly<Record<string, string | number>>;

/** A coordinate or size in a host-rendered surface. */
export type SandboxPlacementUnit = "px" | "fraction" | "percent";

/** Where a surface or node sits relative to its containing surface. */
export interface SandboxPlacement {
  /** Normalized position, 0-1, independent of `unit`. */
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  /** Unit for `width`/`height`: 0-1 fraction, 0-100 percent, or CSS pixels. */
  readonly unit?: SandboxPlacementUnit;
  readonly anchor?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "center-left"
    | "center"
    | "center-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  readonly z?: number;
}

/** One frame in a host-played animation. */
export interface SandboxAnimationFrame {
  readonly src: string;
  /** Per-frame duration; `fps` is used when omitted. */
  readonly durationMs?: number;
}

/** An image, GIF, or host-played frame sequence. */
export type SandboxMedia =
  | { readonly kind: "image"; readonly src: string }
  | {
      readonly kind: "animation";
      readonly frames: readonly SandboxAnimationFrame[];
      readonly fps?: number;
      readonly loop?: boolean;
    };

/** An image, GIF, or animation placed inside a surface. */
export interface SandboxMediaNode {
  readonly kind: "media";
  readonly id?: string;
  readonly media: SandboxMedia;
  readonly placement?: SandboxPlacement;
  readonly fit?: "contain" | "cover" | "fill";
  /** Non-empty alternative text; media is never rendered as a decorative blank. */
  readonly alt: string;
  readonly pointerEvents?: "auto" | "none";
  readonly draggable?: boolean;
}

/** A first-class button with independent placement. */
export interface SandboxButtonNode {
  readonly kind: "button";
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly placement?: SandboxPlacement;
  readonly variant?: "solid" | "outlined" | "ghost" | "danger";
  readonly disabled?: boolean;
}

/** A flow or absolutely positioned group of nodes. */
export interface SandboxGroupNode {
  readonly kind: "group";
  readonly id?: string;
  readonly layout?: "flow" | "absolute";
  readonly placement?: SandboxPlacement;
  readonly children: readonly SandboxUiNode[];
}

/** One host-rendered element in a declarative Extension surface. */
export interface SandboxElementNode {
  readonly kind: "element";
  readonly tag: string;
  /** Stable id used to route an input/click event back to the package. */
  readonly id?: string;
  readonly class?: string;
  readonly style?: SandboxStyle;
  readonly attrs?: Readonly<Record<string, string | number | boolean>>;
  readonly text?: string;
  readonly children?: readonly SandboxUiNode[];
}

/** Plain text inside a declarative surface. */
export interface SandboxTextNode {
  readonly kind: "text";
  readonly text: string;
}

/** One node in a declarative surface tree. */
export type SandboxUiNode =
  SandboxElementNode | SandboxTextNode | SandboxMediaNode | SandboxButtonNode | SandboxGroupNode;

/** What the host renderer sends back for one interactive node. */
export interface SandboxUiEvent {
  readonly nodeId: string;
  readonly kind:
    | "click"
    | "input"
    | "change"
    | "file"
    | "pointerdown"
    | "pointermove"
    | "pointerup"
    | "hover-enter"
    | "hover-leave"
    | "keydown"
    | "drag-start"
    | "drag-move"
    | "drag-end";
  readonly value?: string;
  readonly checked?: boolean;
  readonly file?: SandboxPickedImage;
  /** Pointer position normalized to the node's box, 0-1. */
  readonly x?: number;
  readonly y?: number;
  readonly button?: number;
  readonly key?: string;
}

/** A file returned by the host picker; bytes cross the bridge as a byte array. */
export interface SandboxPickedFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** Options for the host file picker. */
export interface SandboxPickFileOptions {
  readonly accept?: readonly string[];
  readonly multiple?: boolean;
  readonly maxBytes?: number;
}

/** Options for the host save dialog. */
export interface SandboxSaveFileOptions {
  readonly suggestedName: string;
  readonly mimeType?: string;
  readonly bytes?: Uint8Array;
}

/** The display name the host used for a saved file. */
export interface SandboxSavedFile {
  readonly name: string;
}

/** A surface that remains mounted until the package disposes it. */
export interface SandboxSurfaceDefinition {
  readonly id: string;
  readonly tree: SandboxUiNode;
  readonly placement?: SandboxPlacement;
  readonly interactive?: boolean;
  readonly draggable?: boolean;
  readonly clickThrough?: boolean;
  /** Optional surface box; nodes may still place themselves inside it. */
  readonly width?: number;
  readonly height?: number;
  readonly order?: number;
  onEvent?(event: SandboxUiEvent): void;
  onClose?(): void;
}

/** A blocking surface; a button click or dismissal resolves the result. */
export interface SandboxModalSurfaceDefinition extends SandboxSurfaceDefinition {
  readonly title?: string;
  /** `none` makes the tree the whole visual; `host` adds the standard frame. */
  readonly chrome?: "host" | "none";
  readonly dismissible?: boolean;
}

/** A non-modal surface anchored to a point, the pointer, or another surface. */
export interface SandboxAnchoredSurfaceDefinition extends SandboxSurfaceDefinition {
  readonly anchor:
    | { readonly kind: "pointer" }
    | { readonly kind: "surface"; readonly id: string }
    | { readonly kind: "node"; readonly nodeId: string }
    | { readonly kind: "point"; readonly x: number; readonly y: number };
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly dismissible?: boolean;
}

/** The result of a modal surface. */
export interface SandboxSurfaceResult {
  readonly action: string | null;
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly dismissed: boolean;
}

/** Base control handle for one rendered panel or overlay tree. */
export interface SandboxSurfaceHandle {
  /** Replace the rendered tree; `replace` remounts inputs to reset their values. */
  update(tree: SandboxUiNode, options?: { replace?: boolean }): void;
  dispose(): void;
}

/** A persistent surface also exposes placement, visibility, and close. */
export interface SandboxPersistentSurfaceHandle extends SandboxSurfaceHandle {
  setPlacement(placement: SandboxPlacement): void;
  setVisible(visible: boolean): void;
  close(): void;
}

/** An image selected through the host picker and returned as a data URL. */
export interface SandboxPickedImage {
  readonly name: string;
  readonly type: string;
  readonly dataUrl: string;
}

/** One panel tree and the event callback routed back to the package. */
export interface SandboxPanelDefinition {
  readonly id: string;
  readonly tree: SandboxUiNode;
  onEvent?(event: SandboxUiEvent): void;
}

/** A panel tree hosted above the editor stage or the window. */
export interface SandboxOverlayDefinition extends SandboxPanelDefinition {
  readonly order?: number;
  readonly scope?: "stage" | "window";
}

/** A sidebar icon route or a standalone divider. */
export type SandboxSidebarDefinition =
  | {
      readonly id: string;
      readonly panelId: string;
      readonly icon: { readonly name: string; readonly label: string; readonly domId?: string };
      readonly order?: number;
    }
  | { readonly kind: "divider"; readonly id: string; readonly order?: number };

/** Promise-based mirror of the host key/value store. */
export interface SandboxStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** Storage adds JSON helpers over the same owner-scoped string entries. */
export interface SandboxJsonStore extends SandboxStore {
  /** Parse one stored value; missing or unparseable text resolves to null. */
  getJSON<T = unknown>(key: string): Promise<T | null>;
  /** Serialize plain JSON data under the 256 KB value bound. */
  setJSON(key: string, value: unknown): Promise<void>;
}

/** Cross-Extension service operations exposed through the asynchronous bridge. */
export interface SandboxServices {
  provide(
    definition: Omit<ExtensionServiceDefinition, "methods"> & {
      methods: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
    },
  ): () => void;
  resolve(id: string, version?: string): Promise<ExtensionServiceInfo | null>;
  call(id: string, method: string, args?: readonly unknown[]): Promise<unknown>;
  onChange(id: string, listener: (info: ExtensionServiceInfo | null) => void): () => void;
  provideData<T>(definition: ExtensionDataProviderDefinition<T>): () => void;
  readData<T = unknown>(id: string, version?: string): Promise<ExtensionDataInfo<T> | null>;
  updateData(id: string, value: unknown): Promise<void>;
  onDataChange<T = unknown>(
    id: string,
    listener: (info: ExtensionDataInfo<T> | null) => void,
  ): () => void;
}

/** Host UI calls available across the sandbox bridge. */
export interface SandboxUiContext {
  notice(message: ExtensionText, options?: Readonly<Record<string, unknown>>): void;
  confirm(message: ExtensionText): Promise<boolean>;
  input(options: Readonly<Record<string, unknown>>): Promise<string | null>;
  select(options: Readonly<Record<string, unknown>>): Promise<string | null>;
  guide(options: Readonly<Record<string, unknown>>): Promise<unknown>;
  progress(
    title: ExtensionText,
    totalSteps?: number,
  ): {
    update(message: string, options?: Readonly<Record<string, unknown>>): void;
    close(): void;
  };
  /** Host-mediated image picker; the package never receives a file handle. */
  pickImage(options?: { maxBytes?: number }): Promise<SandboxPickedImage | null>;
  /** Host-mediated file picker; bytes are bounded and copied across the bridge. */
  pickFile(options?: SandboxPickFileOptions): Promise<readonly SandboxPickedFile[] | null>;
  /** Host save dialog; returns a display name, never a filesystem path. */
  saveFile(options: SandboxSaveFileOptions): Promise<SandboxSavedFile | null>;
  /** Mount a persistent surface with arbitrary media and pointer input. */
  registerSurface(definition: SandboxSurfaceDefinition): SandboxPersistentSurfaceHandle;
  /** Open a blocking surface; button ids become the result action. */
  openModalSurface(definition: SandboxModalSurfaceDefinition): Promise<SandboxSurfaceResult>;
  /** Open a non-modal surface next to an anchor; returns a live handle. */
  openAnchoredSurface(definition: SandboxAnchoredSurfaceDefinition): SandboxPersistentSurfaceHandle;
  registerPanel(definition: SandboxPanelDefinition): SandboxSurfaceHandle;
  /** Read the versioned host design-component and slot catalog. */
  designCatalog(): Promise<ExtensionDesignCatalog>;
  /** Register a declarative design component in a host-owned panel slot. */
  registerDesignPanel(
    definition: Omit<ExtensionDesignPanelDefinition, "onEvent"> & {
      onEvent?(event: ExtensionDesignEvent): void;
    },
  ): () => void;
  registerOverlay(definition: SandboxOverlayDefinition): SandboxSurfaceHandle;
  registerSidebar(definition: SandboxSidebarDefinition): () => void;
}

/** Package-relative media assets exposed inside the sandbox. */
export interface SandboxAssets {
  /** Declared asset names, stable in manifest order. */
  names(): readonly string[];
  /** Copy one asset's bytes across the bridge. */
  read(name: string): Promise<Uint8Array>;
  /** Resolve one asset to a data URL the opaque sandbox can render. */
  url(name: string): Promise<string>;
  /** Read the declared media type, size, and atlas metadata without exposing a path. */
  info(name: string): Promise<AssetInfo>;
}

/** The context a sandboxed script receives. */
export interface SandboxScriptContext {
  readonly manifest: MaterializedExtensionManifest;
  readonly signal: AbortSignal;
  readonly api: SandboxReduxApi;
  readonly i18n: ExtensionI18n;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ui: SandboxUiContext;
  readonly assets: SandboxAssets;
}

/** A script contribution declared inside the sandbox. */
export interface SandboxScriptDefinition {
  readonly id: string;
  readonly label: ExtensionText;
  readonly description?: ExtensionText;
  readonly icon?: string;
  readonly defaultShortcuts?: readonly Shortcut[];
  /** Where the script shortcut runs; defaults to the editor workspace. */
  readonly shortcutScope?: ShortcutScope;
  readonly parameters?: ExtensionParameterSchema;
  readonly steps?: readonly ExtensionScriptStep[];
  run?(context: SandboxScriptContext): void | Promise<void>;
}

/** The context a sandboxed entry receives. It has no host DOM, IPC, or network. */
export interface SandboxExtensionContext {
  readonly manifest: MaterializedExtensionManifest;
  readonly signal: AbortSignal;
  readonly api: SandboxReduxApi;
  readonly i18n: ExtensionI18n;
  readonly ui: SandboxUiContext;
  readonly assets: SandboxAssets;
  readonly events: {
    on(name: string, callback: (payload: unknown) => void, priority?: number): () => void;
  };
  readonly hooks: {
    register(
      name: string,
      callback: (payload: Record<string, unknown>) => unknown | Promise<unknown>,
      schema: PublicHookPayloadSchema,
      priority?: number,
    ): () => void;
    invoke(
      name: string,
      payload: Record<string, unknown>,
      options?: PublicHookInvokeOptions,
    ): Promise<PublicHookInvocationResult>;
  };
  readonly services: SandboxServices;
  readonly scripts: {
    register(definition: SandboxScriptDefinition): () => void;
  };
  readonly settings: SandboxStore;
  readonly storage: SandboxJsonStore;
  readonly timers: {
    setTimeout(callback: () => void, delay: number): ReturnType<typeof globalThis.setTimeout>;
    setInterval(callback: () => void, delay: number): ReturnType<typeof globalThis.setInterval>;
    requestAnimationFrame(callback: FrameRequestCallback): number;
    clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void;
    clearInterval(handle: ReturnType<typeof globalThis.setInterval>): void;
    cancelAnimationFrame(handle: number): void;
  };
  readonly styles: { add(cssText: string): () => void };
  addCleanup(cleanup: () => void): () => void;
}

/** The default export shape a sandboxed entry module provides. */
export interface SandboxedExtensionDefinition {
  manifest: TrustedExtensionManifest;
  translations?: ExtensionTranslations;
  activate?(context: SandboxExtensionContext): void | Promise<void>;
}

/** One captured console entry from a cell. */
export interface SandboxCellLog {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
  readonly atMs: number;
}

/** One cell failure as reported by the iframe. */
export interface SandboxCellError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

/** The iframe-level outcome of one cell run. */
export interface SandboxCellResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly logs: readonly SandboxCellLog[];
  readonly error?: SandboxCellError;
  readonly durationMs: number;
  readonly truncated: boolean;
}

/** A running sandbox; the host runtime owns this lifetime. */
export interface ExtensionSandboxHost {
  start(): Promise<void>;
  dispose(): void;
  /** Cell mode only: resolves when the cell finishes; absent for extensions. */
  runCell?(): Promise<SandboxCellResult>;
}

/** Whether this sandbox runs a package entry or one one-shot cell. */
export type ExtensionSandboxMode = "extension" | "cell";

/** Everything the iframe factory needs to build one sandbox. */
export interface ExtensionSandboxFactoryInput {
  /** Defaults to `extension`; cell mode uses the same iframe and bridge. */
  mode?: ExtensionSandboxMode;
  manifest: MaterializedExtensionManifest;
  translations: ExtensionTranslations | undefined;
  source: string;
  /** Package media reader; absent when the loader has no declared assets. */
  assets?: ExtensionAssetResolver;
  /** Capability-gated host handles used only by the bridge, never by the package. */
  context: ExtensionHostContext;
  reportFailure(error: unknown, action: string): void;
  /** Cell mode only: the value exposed to the cell as `input`. */
  input?: unknown;
  /** Cell mode only: execution budget in milliseconds. */
  timeoutMs?: number;
}

/** Frontend-owned factory that creates the iframe and bridge for one run. */
export type ExtensionSandboxFactory = (input: ExtensionSandboxFactoryInput) => ExtensionSandboxHost;
