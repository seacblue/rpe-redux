/**
 * Compile-time guard for the published Extension SDK surface.
 *
 * The file has no runtime behaviour. It imports and assigns the names that
 * public handle signatures mention, so `npm run check:sdk` fails when a type
 * exists in the host source but is missing from `src/core/api/sdk.ts`.
 */
import type {
  ChartReadCollection,
  ChartReadItem,
  ChartReadState,
  CodeCellApi,
  ExtensionDesignCatalog,
  ExtensionDesignNode,
  ExtensionDesignPanelDefinition,
  DocumentRevisions,
  ExtensionEventPayloads,
  ExtensionHookPayloads,
  PreviewFrameImage,
  PreviewFrameRequest,
  ReduxApi,
  SandboxOverlayDefinition,
  SandboxPanelDefinition,
  SandboxSidebarDefinition,
  SandboxStyle,
  TransactionConflict,
  TransactionPreviewStatus,
} from "@rpe-redux/extension-sdk";

/** Every property must resolve; removing an export breaks this interface. */
interface PublishedSurface {
  readonly chartState: ChartReadState;
  readonly chartCollection: ChartReadCollection;
  readonly chartItem: ChartReadItem<"notes">;
  readonly revisions: DocumentRevisions;
  readonly eventPayloads: ExtensionEventPayloads;
  readonly hookPayloads: ExtensionHookPayloads;
  readonly panel: SandboxPanelDefinition;
  readonly overlay: SandboxOverlayDefinition;
  readonly sidebar: SandboxSidebarDefinition;
  readonly style: SandboxStyle;
  readonly conflict: TransactionConflict;
  readonly previewStatus: TransactionPreviewStatus;
  readonly frameRequest: PreviewFrameRequest;
  readonly frameImage: PreviewFrameImage;
  readonly designCatalog: ExtensionDesignCatalog;
  readonly designNode: ExtensionDesignNode;
  readonly designPanel: ExtensionDesignPanelDefinition;
}

/** Concrete assignments also pin field names and literal unions. */
const revisions: DocumentRevisions = {
  chartFingerprint: "chart",
  diskSnapshot: null,
  generation: 1,
};
const conflict: TransactionConflict = {
  code: "chartFingerprint",
  expectedFingerprint: "before",
  currentFingerprint: "after",
};
const previewStatus: TransactionPreviewStatus = "previewed";
const style: SandboxStyle = { color: "#ffffff", width: 10 };
const panel: SandboxPanelDefinition = {
  id: "panel",
  tree: { kind: "text", text: "hello" },
};
const overlay: SandboxOverlayDefinition = { ...panel, scope: "window" };
const sidebar: SandboxSidebarDefinition = { kind: "divider", id: "separator" };
const designNode: ExtensionDesignNode = {
  type: "button",
  version: 1,
  props: { id: "run", label: "Run", variant: "solid" },
};
const designPanel: ExtensionDesignPanelDefinition = {
  id: "panel",
  slot: "inspector.panel",
  component: designNode,
};
const designCatalog: ExtensionDesignCatalog = {
  sdkVersion: "1.0.0",
  slots: [],
  components: [],
};

/**
 * The package facade omits the host-only handles; `workspace` and `extensions`
 * must stay outside both `ReduxApi` and `CodeCellApi`. `help` is available when
 * the package holds `ui.guide`.
 */
type AssertNever<T extends never> = T;
type ExcludedSandboxHandle = AssertNever<Extract<"workspace" | "extensions", keyof ReduxApi>>;
type ExcludedCellHandle = AssertNever<Extract<"workspace" | "extensions", keyof CodeCellApi>>;

declare const surface: PublishedSurface | null;
void surface;
void revisions;
void conflict;
void previewStatus;
void style;
void panel;
void overlay;
void sidebar;
void designCatalog;
void designNode;
void designPanel;
