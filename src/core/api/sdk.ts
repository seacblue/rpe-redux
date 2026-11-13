/**
 * Owns the curated type surface for Extension authors.
 *
 * `sdk/index.d.ts` re-exports this module and nothing else, so adding a name
 * here publishes it to the SDK. Runtime values stay out: an Extension reads the
 * live host through the capability-gated, asynchronous `context.api`, and the
 * SDK only describes those shapes. `window.redux` is the separate host facade
 * for the development server and automation, not the package contract.
 */
export type { ApiAvailability, ApiError, ApiErrorCode, ApiResult } from "./contract.ts";
export type { ActionResult, ActionReason, ActionStatus } from "../edit/operations/result.ts";
export type { SandboxReduxApi as ReduxApi } from "../extensions/sandbox.ts";
export type {
  ChartHandle as ChartApi,
  ChartEventReadRef,
  ChartObjectId,
  ChartReadCollection,
  ChartReadEvent,
  ChartReadItem,
  ChartReadLine,
  ChartReadMeta,
  ChartReadNote,
  ChartNoteReadRef,
  ChartReadPage,
  ChartReadPageOptions,
  ChartReadSnapshot,
  ChartReadState,
  ChartResourceReference,
} from "./chart.ts";
export type {
  CreateDocumentOptions,
  DocumentActionOptions,
  DocumentFormat,
  DocumentReplacePolicy,
  DocumentSnapshot,
  DocumentState,
  DocumentStatus,
  OpenBytesOptions,
  SaveDocumentOptions,
} from "./document.ts";
export type {
  HitTestArea,
  HitTestAtRequest,
  HitTestAtResult,
  HitTestAtSnapshot,
  HitTestAtOrdering,
  HitTestCoordinateSpace,
  HitTestEventLayer,
  HitTestEventType,
  HitTestKind,
  HitTestLineGeometry,
  HitTestMode,
  HitTestNoteGeometry,
  HitTestPoint,
  HitTestPreviewGeometry,
  HitTestRequest,
  HitTestResult,
  HitTestSurface,
  HitTestTime,
  HitTestTimeRequest,
  HitTestValue,
} from "./hitTest.ts";
export type {
  LibraryAssetSummary,
  LibraryHandle as LibraryApi,
  LibraryProject,
  LibraryProjectSummary,
  LibraryRevision,
  LibraryRevisionSummary,
  ListQuery,
  LocalLibraryError,
  ProjectPatch,
  RequestOptions,
} from "./library.ts";
export type {
  PlaybackHandle as PlaybackApi,
  PlaybackClock,
  PlaybackFrame,
  PlaybackFrameLine,
  PlaybackFrameNote,
  PlaybackSeekOptions,
  PlaybackState,
  PlaybackTextureStatus,
} from "./playback.ts";
export type {
  EventLayerRef,
  EventSelectionRangeRequest,
  EventSelectionRequest,
  NoteSelectionRangeRequest,
  NoteSelectionRequest,
  SelectionHandle as SelectionApi,
  SelectionSnapshot,
  SelectedEventRef,
  SelectionMode,
  SelectionOperationResult,
  SelectionPasteRequest,
  SelectionPoint,
} from "./selection.ts";
export type {
  SettingDefinition,
  SettingText,
  SettingsApi,
  SettingsNavigation,
} from "./settings.ts";
export type {
  HelpApi,
  HelpText,
  HelpTutorialDefinition,
  HelpTutorialPlacement,
  HelpTutorialStep,
} from "./help.ts";
export type { ShortcutCategory, ShortcutDefinition, ShortcutDisposer } from "./shortcuts.ts";
export type {
  SidebarDivider,
  SidebarEntry,
  SidebarIconDescriptor,
  SidebarItem,
} from "./sidebar.ts";
export type {
  ExtensionThemeColorRole,
  ExtensionThemeIdentity,
  ExtensionThemeTokens,
} from "./theme.ts";
export type {
  ActionContext,
  ContextMenuTarget,
  ToolbarAction,
  ToolbarCells,
  ToolbarControl,
  ToolbarDivider,
  ToolbarEntry,
  ToolbarField,
  ToolbarFieldCommon,
  ToolbarNumberField,
  ToolbarRowName,
  ToolbarSelectField,
  ToolbarSpacer,
} from "./toolbar.ts";
export type { ContextMenuItem, ContextMenuSurface } from "./contextMenu.ts";
export type {
  ChartPatch,
  ChartTransactionPreviewResult,
  ChartTransactionRequest,
  ChartTransactionResult,
  JudgeLinePatch,
  TransactionConflict,
  TransactionEventInsert,
  TransactionEventOperations,
  TransactionHistoryResult,
  TransactionHistoryState,
  TransactionHistorySummary,
  TransactionIssue,
  TransactionJudgeLineUpdate,
  TransactionLineInsert,
  TransactionLineOperations,
  TransactionLineTarget,
  TransactionNoteInsert,
  TransactionNoteOperations,
  TransactionObjectUpdate,
  TransactionPreviewStatus,
  TransactionStatus,
  TransactionTimingOperations,
  TransactionHandle as TransactionApi,
} from "./transaction.ts";
export type { PublicValueDefinition, ValueHandle } from "./values.ts";

/* Editor snapshots exposed by the preview and layout handles. */
export type {
  PreviewObject,
  PreviewObjectGeometry,
  PreviewObjectKind,
  PreviewPoint,
  PreviewRect,
  PreviewSnapshot,
} from "../edit/preview/api.ts";
export type {
  PreviewFrameFormat,
  PreviewFrameImage,
  PreviewFrameRequest,
  PreviewFrameSpec,
} from "../edit/preview/frame.ts";
export type {
  LayoutAnchor,
  LayoutAnchorKind,
  LayoutRect,
  LayoutSnapshot,
} from "../edit/layout/api.ts";

/* Extension capabilities, UI definitions, and runtime contracts. */
export type { ExtensionCapability } from "../extensions/capabilities.ts";
export type { ExtensionEventPayloads, ExtensionHookPayloads } from "../extensions/contract.ts";
export type {
  ExtensionHookObject,
  PublicHookHandler,
  PublicHookInvokeOptions,
  PublicHookInvocationResult,
  PublicHookError,
  PublicHookFieldSchema,
  PublicHookFieldType,
  PublicHookPayloadSchema,
} from "../extensions/publicHooks.ts";
export type { ExtensionCallbackFailure } from "../extensions/registry.ts";
export type {
  ExtensionConsent,
  ExtensionCollaborationMode,
  ExtensionContent,
  ExtensionLoadOptions,
  ExtensionProvenance,
  ExtensionSource,
  ExtensionTrustState,
  ExtensionJsonStore,
  ExtensionKeyValueStore,
  ExtensionOperationErrorCode,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionStatusSnapshot,
  TrustedExtensionManifest,
} from "../extensions/extensionContract.ts";
export type {
  SandboxCodeCellApi as CodeCellApi,
  SandboxedExtensionDefinition as TrustedExtensionDefinition,
  SandboxElementNode,
  SandboxExtensionContext as TrustedExtensionContext,
  SandboxOverlayDefinition,
  SandboxJsonStore,
  SandboxPanelDefinition,
  SandboxPickedImage,
  SandboxReduxApi,
  SandboxScriptContext as ExtensionScriptContext,
  SandboxScriptDefinition as ExtensionScriptDefinition,
  SandboxSidebarDefinition,
  SandboxStore,
  SandboxStyle,
  SandboxSurfaceHandle,
  SandboxTextNode,
  SandboxUiContext as ScriptUiContext,
  SandboxUiEvent,
  SandboxUiNode,
} from "../extensions/sandbox.ts";
export type {
  ExtensionCatalog,
  ExtensionI18n,
  ExtensionText,
  ExtensionTranslations,
} from "../extensions/i18n.ts";
export type {
  ExtensionParameter,
  ExtensionParameterInput,
  ExtensionParameterSchema,
  ExtensionParameterValue,
} from "../extensions/parameters.ts";
export type {
  BatchStep,
  ExtensionScriptStep,
  NoticeStep,
  SelectStep,
  StepValue,
  TransactionStep,
} from "../extensions/steps.ts";
export type { ExtensionScriptResult, ExtensionScriptSnapshot } from "../extensions/scripts.ts";
export type { ScriptUiCapability, ScriptUiRequest } from "../extensions/scriptUi.ts";
export type {
  ExtensionDesignCatalog,
  ExtensionDesignComponentCatalogEntry,
  ExtensionDesignComponentId,
  ExtensionDesignEvent,
  ExtensionDesignNode,
  ExtensionDesignPanelDefinition,
  ExtensionDesignSlotCatalogEntry,
  ExtensionDesignSlotId,
  ExtensionDesignValidationCode,
} from "../extensions/designComponents.ts";
export type {
  ExtensionDataInfo,
  ExtensionDataProviderDefinition,
  ExtensionServiceDefinition,
  ExtensionServiceError,
  ExtensionServiceErrorCode,
  ExtensionServiceInfo,
  ExtensionServiceMethod,
} from "../extensions/serviceRegistry.ts";
export type { SandboxServices } from "../extensions/sandbox.ts";

/* One-shot code-cell request, result, and error contracts. */
export type { DocumentRevisions } from "../contracts/revisions.ts";
export type {
  CodeCellError,
  CodeCellErrorCode,
  CodeCellLog,
  CodeCellProfile,
  CodeCellRequest,
  CodeCellResult,
  CodeCellRevisions,
} from "../codecell/contract.ts";
