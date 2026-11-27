/**
 * Compile-time guard for the published Extension SDK surface.
 *
 * The file has no runtime behaviour. It imports and assigns the names that
 * public handle signatures mention, so `npm run check:sdk` fails when a type
 * exists in the host source but is missing from `src/core/api/sdk.ts`.
 */
import type {
  ChartObjectId,
  Beat,
  ChartReadAllOptions,
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
  ScriptUiContext,
  SelectedEventRef,
  SelectedNoteRef,
  SandboxAnchoredSurfaceDefinition,
  SandboxAssets,
  SandboxMediaNode,
  SandboxModalSurfaceDefinition,
  SandboxOverlayDefinition,
  SandboxPanelDefinition,
  SandboxPickedFile,
  SandboxPlacement,
  SandboxSidebarDefinition,
  SandboxStyle,
  SandboxSurfaceResult,
  TransactionConflict,
  TransactionPreviewStatus,
} from "@rpe-redux/extension-sdk";

/** Every property must resolve; removing an export breaks this interface. */
interface PublishedSurface {
  readonly chartState: ChartReadState;
  readonly chartCollection: ChartReadCollection;
  readonly chartItem: ChartReadItem<"notes">;
  readonly timingItem: ChartReadItem<"timing">;
  readonly readAllOptions: ChartReadAllOptions;
  readonly selectedNote: SelectedNoteRef;
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
const selectedNote: SelectedNoteRef = {
  id: "note-id" as ChartObjectId,
  lineIndex: 0,
  index: 0,
};
const selectedEvent: SelectedEventRef = {
  id: "event-id" as ChartObjectId,
  lineIndex: 0,
  eventType: "moveXEvents",
  layer: 0,
  index: 0,
};
const lineId = "line-id" as ChartObjectId;
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

/**
 * Host-tool operations stay off the package facade. `layout.availability`
 * remains, but its anchors do not.
 */
type RemovedPackageMethod =
  | Extract<"snapshot" | "metadata" | "lines" | "notes" | "events", keyof ReduxApi["chart"]>
  | Extract<
      | "replay"
      | "inspect"
      | "renderAt"
      | "textures"
      | "frames"
      | "startMeasurement"
      | "stopMeasurement"
      | "metrics"
      | "resetDiagnostics",
      keyof ReduxApi["playback"]
    >
  | Extract<"refresh" | "available" | "bindings" | "shortcutText", keyof ReduxApi["toolbar"]>
  | Extract<"getHandle", keyof ReduxApi["values"]>
  | Extract<"subscribeAll" | "snapshot", keyof ReduxApi["values"]["byId"]>
  | Extract<"trace", keyof ReduxApi["diagnostics"]>
  | Extract<"geometry", keyof ReduxApi["hitTest"]>
  | Extract<"frame", keyof ReduxApi["preview"]>
  | Extract<"layout", keyof ReduxApi>
  | Extract<"openChangelog" | "openGuide", keyof ReduxApi["help"]>;
type AssertRemovedPackageMethods = AssertNever<RemovedPackageMethod>;

/** A whole-collection read resolves to one array without any page fields. */
declare const api: ReduxApi;
async function readAllNotes(): Promise<void> {
  const result = await api.chart.readAll("notes", { limit: 10 });
  if (result.ok) {
    for (const note of result.value) {
      void note.id;
    }
  }
}

/** Exact chart arithmetic is published through the asynchronous chart facade. */
async function addBeats(): Promise<void> {
  const result = await api.chart.beats.addFraction([2, 0, 1], 1, 2);
  if (result.ok) {
    const beat: Beat = result.value;
    void beat;
  }
}

/** The timing collection exposes the tempo map accepted by the transaction handle. */
async function readAllTiming(): Promise<void> {
  const result = await api.chart.readAll("timing");
  if (result.ok) {
    for (const entry of result.value) {
      void entry.bpm;
      void entry.startTime;
    }
  }
}

/** Line deletion is an id-addressed topology operation. */
async function deleteLine(): Promise<void> {
  await api.transaction.apply({
    lines: { delete: [lineId] },
  });
}

/** Revisions can be read without handling page offsets. */
async function readAllRevisions(): Promise<void> {
  const result = await api.library.current.revisionsAll();
  if (result.ok) {
    const revisions = result.value.revisions;
    const snapshotToken: string = result.value.snapshotToken;
    void revisions;
    void snapshotToken;
  }
}

/** A recipe plan is a detached summary that is committed once. */
async function planRecipe(): Promise<void> {
  const planned = await api.recipe.plan({ steps: [] });
  if (planned.ok) {
    void planned.value.planId;
    void planned.value.counts.notes;
    await api.recipe.apply(planned.value.planId ?? "");
  }
  await api.recipe.cancel("plan");
}

/** Package media is declared in the manifest and resolved through the bridge. */
declare const assets: SandboxAssets;
async function readAssets(): Promise<void> {
  for (const name of assets.names()) {
    void name;
  }
  const bytes: Uint8Array = await assets.read("idle");
  const url: string = await assets.url("idle");
  const info = await assets.info("idle");
  void bytes;
  void url;
  void info.type;
  void info.bytes;
  void info.width;
  void info.height;
  void info.atlas?.frameWidth;
}

/** Surfaces accept arbitrary media, absolute buttons, and pointer placement. */
declare const ui: ScriptUiContext;
async function renderSurfaces(): Promise<void> {
  const placement: SandboxPlacement = {
    x: 0.5,
    y: 0.5,
    width: 320,
    height: 240,
    unit: "px",
    anchor: "center",
    z: 10,
  };
  const media: SandboxMediaNode = {
    kind: "media",
    id: "sprite",
    media: {
      kind: "animation",
      frames: [{ src: "data:image/png;base64,AA==", durationMs: 80 }],
      fps: 12,
      loop: true,
    },
    placement,
    alt: "sprite",
  };
  const modal: SandboxModalSurfaceDefinition = {
    id: "modal",
    chrome: "none",
    width: 360,
    height: 260,
    tree: {
      kind: "group",
      layout: "absolute",
      children: [
        media,
        {
          kind: "button",
          id: "confirm",
          label: "Confirm",
          placement: { x: 0.8, y: 0.9, unit: "fraction", anchor: "center" },
        },
      ],
    },
  };
  const anchored: SandboxAnchoredSurfaceDefinition = {
    ...modal,
    id: "anchored",
    anchor: { kind: "pointer" },
    side: "top",
  };
  const handle = ui.registerSurface(modal);
  handle.setPlacement(placement);
  handle.setVisible(true);
  const result: SandboxSurfaceResult = await ui.openModalSurface(modal);
  void result.action;
  void result.values;
  ui.openAnchoredSurface(anchored).close();
  const picked: readonly SandboxPickedFile[] | null = await ui.pickFile({
    accept: ["image/*"],
    multiple: false,
  });
  void picked;
  await ui.saveFile({ suggestedName: "notes.txt", bytes: new Uint8Array() });
}

/** Playback exposes a coalesced clock with a disposer. */
async function subscribePlayback(): Promise<void> {
  const stop = await api.playback.subscribe(
    (tick) => {
      void tick.chartSeconds;
      void tick.beat;
    },
    { maxHz: 15 },
  );
  stop();
}

declare const surface: PublishedSurface | null;
void surface;
void readAllNotes;
void addBeats;
void readAllTiming;
void deleteLine;
void readAllRevisions;
void planRecipe;
void subscribePlayback;
void readAssets;
void renderSurfaces;
void selectedEvent;
void lineId;
void revisions;
void conflict;
void previewStatus;
void selectedNote;
void style;
void panel;
void overlay;
void sidebar;
void designCatalog;
void designNode;
void designPanel;
