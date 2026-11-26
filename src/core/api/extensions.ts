/**
 * Owns the read-only Extension status handle for external observers and
 * diagnostics.
 *
 * Management operations live in the settings surface, and package subscriptions
 * live in the capability-gated `TrustedExtensionContext`. This handle exposes no load,
 * enable, unload, or run operation.
 */
import {
  extensionRuntime,
  TRUSTED_EXTENSION_RISK_NOTICE,
  type ExtensionStatusSnapshot,
} from "../extensions/extensionRuntime.ts";
import type { ExtensionsApi } from "../extensions/contract.ts";

/** Extension status exposed to external observers and diagnostics. */
export const extensions: ExtensionsApi = Object.freeze({
  /** The risk notice every trusted Extension manifest carries. */
  riskNotice: TRUSTED_EXTENSION_RISK_NOTICE,
  /** The current status snapshot for every known Extension. */
  list(): readonly ExtensionStatusSnapshot[] {
    return extensionRuntime.list();
  },
  /** Observe status changes; the returned function stops the subscription. */
  subscribe(listener: () => void) {
    return extensionRuntime.subscribe(listener);
  },
});

export type {
  ChartParsePayload,
  ChartParsedPayload,
  ChartSerializePayload,
  ChartValidatePayload,
  ExtensionEventPayloads,
  ExtensionHookPayloads,
  DocumentBeforeClosePayload,
  DocumentBeforeCreatePayload,
  DocumentBeforeOpenPayload,
  DocumentBeforeSavePayload,
  DocumentLifecyclePayload,
  ExtensionsApi,
  SessionAfterCommitPayload,
  SessionBeforeCommitPayload,
  SelectionAfterPastePayload,
  SelectionBeforePastePayload,
} from "../extensions/contract.ts";
export type {
  ExtensionCallbackFailure,
  ExtensionDisposer,
  ExtensionSubscriptionOptions,
} from "../extensions/registry.ts";
export type {
  ExtensionCollaborationMode,
  ExtensionKeyValueStore,
  ExtensionOperationErrorCode,
  ExtensionOperationResult,
  ExtensionRuntimeOptions,
  ExtensionStatus,
  ExtensionStatusSnapshot,
  TrustedExtensionContext,
  TrustedExtensionManifest,
} from "../extensions/extensionRuntime.ts";
export type {
  SandboxedExtensionDefinition as TrustedExtensionDefinition,
  SandboxElementNode,
  SandboxExtensionContext,
  SandboxPickedImage,
  SandboxReduxApi,
  SandboxScriptContext as ExtensionScriptContext,
  SandboxScriptDefinition as ExtensionScriptDefinition,
  SandboxStore,
  SandboxSurfaceHandle,
  SandboxTextNode,
  SandboxUiContext as ExtensionUiContext,
  SandboxUiEvent,
  SandboxUiNode,
} from "../extensions/sandbox.ts";
export type {
  PersistenceJson,
  PersistenceMatch,
  PersistenceObjectKind,
  PersistenceOutput,
  PersistenceProjection,
  PersistenceRuleDefinition,
  PersistenceRuleStatus,
  PersistenceWarning,
} from "./persistence.ts";
export type {
  WorkspaceShaderExportPolicy,
  WorkspaceShaderMaskBinding,
  WorkspaceShaderMaskDefinition,
  WorkspaceShaderPortableDefinition,
  WorkspaceShaderExportMode,
  WorkspaceShaderPassDefinition,
  WorkspaceShaderPassStatus,
  WorkspaceShaderPosition,
  WorkspaceShaderWarning,
} from "./shader.ts";
export type { NoteFieldDefinition, NoteFieldOption, NoteFieldStatus } from "./noteFields.ts";
export type {
  ChartRenderLayerDefinition,
  ChartRenderLayerId,
} from "../global/chart/shader/renderLayers.ts";
export type { ExtensionScriptResult, ExtensionScriptSnapshot } from "../extensions/scripts.ts";
