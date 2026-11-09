/**
 * State and gesture handling for the stage's control balls: hit regions,
 * drag previews, and committed selection edits. Notes use them for batch edits;
 * event balls are the only way to move or resize selected events. Selection math
 * lives in core/edit; this class owns the overlay state and pointer mapping.
 */
import type { TimelineArea } from "../../../../../../core/edit/timeline/types.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { SelectionSnapshot } from "../../../../../../core/edit/selection/snapshot.ts";
import type { SelectionEditResult } from "../../../../../../core/edit/selection/edits.ts";

import type { Timeline } from "../../timeline/surface/timeline.ts";
import { previewSession } from "./previewSession.ts";
import {
  batchDragDeltas,
  batchSelectionSignature,
  selectionPanelBounds,
} from "../../../../../../core/edit/multiEdit/drag.ts";
import {
  createKeyedValue,
  createValue,
  type KeyedValueCell,
  type ValueCell,
} from "../../../../../../core/state/values.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import { batchControlConfigurations, type BatchControlSpec } from "./batchControlSpecs.ts";
import { captureSelection } from "../../../../../../core/edit/selection/snapshot.ts";
import {
  controlSelection,
  selectionScaleAnchor,
} from "../../../../../../core/edit/selection/control.ts";
import { commitSelectionEdit } from "../../../../../../core/edit/selection/edits.ts";
import { BATCH_SHORTCUT_IDS } from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import { matches, released } from "../../../../../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../../../../../core/shortcuts/registry.ts";
import { t } from "../../../../../../i18n/index.ts";

/** Whether a live binding of `id` answers to this keyboard event. */
function bound(id: string, event: KeyboardEvent): boolean {
  return shortcutRegistry.bindingsOf(id).some((binding) => matches(event, binding));
}

/** Whether the released key belongs to one binding of `id`. */
function releasedBinding(id: string, event: KeyboardEvent): boolean {
  return shortcutRegistry.bindingsOf(id).some((binding) => released(event, binding));
}

export interface BatchControlPresentation {
  visible: boolean;
  left: string;
  top: string;
}
export interface BatchControlActions {
  onDown(area: string, kind: string, event: PointerEvent, button: HTMLButtonElement): void;
  onMove(event: PointerEvent): void;
  onUp(event: PointerEvent): void;
  onCancel(): void;
}
export interface BatchControlsState {
  readonly actions: ValueCell<BatchControlActions | null>;
  readonly presentations: ValueCell<Record<string, BatchControlPresentation>>;
  readonly hints: KeyedValueCell<string>;
}

export function createBatchControlsState(): BatchControlsState {
  return Object.freeze({
    actions: createValue<BatchControlActions | null>({ initial: null }),
    presentations: createValue<Record<string, BatchControlPresentation>>({
      initial: {},
      equals: (a, b) => {
        const areas = Object.keys(a);
        return (
          areas.length === Object.keys(b).length &&
          areas.every((area) => {
            const next = b[area];
            return (
              next !== undefined &&
              a[area].visible === next.visible &&
              a[area].left === next.left &&
              a[area].top === next.top
            );
          })
        );
      },
    }),
    hints: createKeyedValue<string>({ initial: "" }),
  });
}

type BatchTimeline = Pick<
  Timeline,
  "notesCanvas" | "eventsCanvas" | "cancelPlacement" | "changed" | "setPreview"
> & {
  viewport: Pick<
    Timeline["viewport"],
    | "panelWidth"
    | "panelIndex"
    | "panelStride"
    | "multiLineViewportOffset"
    | "point"
    | "tempo"
    | "origin"
    | "judgementOffset"
    | "scale"
    | "scaleForArea"
    | "notePositionAt"
    | "division"
    | "factorForLine"
    | "noteInset"
    | "snapX"
    | "gridCount"
  >;
  gestures: Pick<
    Timeline["gestures"],
    "cursor" | "eventCursor" | "clipboardPointer" | "scaleAxis" | "scaleAxisLine" | "preview"
  >;
};

/** A canvas-space point with the minimum surface required by callers. */
interface Point {
  x: number;
  y: number;
}

/** Horizontal panel bounds. */
interface Bounds {
  left: number;
  right: number;
  width: number;
}

interface Group {
  signature: string;
  left?: string;
  top?: string;
}

/**
 * One pointer-down on a control ball: everything needed to keep previewing, to decide whether
 * the document is still the one the drag started on, and to commit or abandon it.
 *
 * The drag is a *proposal* until `up()`: `snapshot` is the selection as it was captured at
 * pointer-down, `result` is what `controlSelection` currently makes of it, and the timeline
 * draws `result` through `setPreview` so the canvas shows the outcome before anything is
 * committed. `session` is kept by reference to detect a document swap under the pointer.
 */
interface ActiveBatch {
  /** The session as it was when the drag began; compared by identity before committing. */
  session: EditorSession;
  /** The captured selection the transforms are applied to; never read from the live session. */
  snapshot: SelectionSnapshot;
  /** The control-ball kind (`note-move`, `note-scale`, …); selects the transform and the label. */
  kind: string;
  /** The ball element that follows the pointer, and whose pointer capture this drag owns. */
  button: HTMLButtonElement;
  /** The control group that moves as one unit while the pointer is down. */
  group: HTMLElement;
  /** Undo-history action name supplied by the control-ball definition. */
  label: string;
  /** Which of the two timelines the drag belongs to; decides the panel geometry. */
  area: TimelineArea;
  /** The line the selection sat on when the drag began; changes are reported as a line change. */
  lineIndex: number;
  /** The selection's screen bounds at pointer-down, used to place the floating readout. */
  bounds: Bounds;
  /** `area` + selection signature at pointer-down; a different one means the selection moved. */
  signature: string;
  /** The pointer capture this drag owns; events from any other pointer are ignored. */
  pointerId: number;
  /** Canvas-space point of pointer-down; deltas are measured from here. */
  start: Point;
  /** Canvas-space point of the latest pointer event; updated by `move`. */
  point: Point;
  /** The canvas the drag began on, used for panel widths and the height-to-beat scale. */
  canvas: HTMLCanvasElement;
  /** Beats per vertical unit for this drag, before any per-line factor is applied. */
  unit: number;
  /** The drag's scale factor at pointer-down; per-line factors refine it. */
  factor: number;
  /** Beat under the pointer at pointer-down; the delta is reported relative to it. */
  startBeat: number;
  /** Screen x at pointer-down, used by the scale transform's anchor. */
  startX: number;
  /** Computed by `controlSelection`; present only during a drag. */
  result?: SelectionEditResult;
}

/** `kind` → control-ball definition; `down()` uses it to recover the undo label. */
const controlsByKind = new Map<string, BatchControlSpec>(
  Object.values(batchControlConfigurations)
    .flat()
    .map((spec) => [spec.kind, spec]),
);

export class BatchControls {
  stage: HTMLElement;
  timeline: BatchTimeline;
  getSession: () => EditorSession;
  enabled: () => boolean;
  reportError: (error: unknown) => void;
  groups: Map<TimelineArea, Group>;
  active: ActiveBatch | null;
  /** Clear another inspector proposal after this batch becomes the committed chart. */
  onCommit?: () => void;
  private cancelledPointerCapture: { button: HTMLButtonElement; pointerId: number } | null;
  anchorMode: number;
  private readonly state: BatchControlsState;

  constructor(
    stage: HTMLElement,
    timeline: BatchTimeline,
    getSession: () => EditorSession,
    enabled: () => boolean,
    reportError: (error: unknown) => void,
    scope: ResourceScope,
    state: BatchControlsState,
  ) {
    this.state = state;
    this.stage = stage;
    this.timeline = timeline;
    this.getSession = getSession;
    this.enabled = enabled;
    this.reportError = reportError;
    this.groups = new Map();
    this.active = null;
    this.cancelledPointerCapture = null;
    this.anchorMode = 0;
    for (const area of Object.keys(batchControlConfigurations) as TimelineArea[]) {
      this.groups.set(area, { signature: "" });
      state.hints.set(area, "");
      state.presentations.update({
        ...state.presentations.get(),
        [area]: { visible: false, left: "", top: "" },
      });
    }
    state.actions.set({
      onDown: (area, kind, event, button) =>
        this.down(event, area === "events" ? "events" : "notes", kind, button),
      onMove: (event) => this.move(event),
      onUp: (event) => this.up(event),
      onCancel: () => this.cancel(),
    });
    // Pointer capture is the primary path, but a few embedded WebView input sources can
    // retarget a captured move/up to the canvas. Keep the active drag alive at the document
    // seam and only handle events that did not reach the control button itself.
    scope.listen(
      document,
      "pointermove",
      (event: Event) => {
        const active = this.active;
        if (active && event.target !== active.button) {
          this.move(event as PointerEvent);
        }
      },
      true,
    );
    scope.listen(
      document,
      "pointerup",
      (event: Event) => {
        const active = this.active;
        if (active && event.target !== active.button) {
          this.up(event as PointerEvent);
        }
      },
      true,
    );
    scope.listen(
      document,
      "pointercancel",
      (event: Event) => {
        const active = this.active;
        if (active && event.target !== active.button) {
          this.cancel();
        }
      },
      true,
    );
    scope.listen(
      window,
      "keydown",
      (event: Event) => {
        const active = this.active;
        const keyboard = event as KeyboardEvent;
        if (!active || !keyboard.key) {
          return;
        }
        if (bound(BATCH_SHORTCUT_IDS.cancel, keyboard)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.cancel(true);
          return;
        }
        if (active.kind !== "note-scale") {
          return;
        }
        if (bound(BATCH_SHORTCUT_IDS.anchorStart, keyboard)) {
          event.preventDefault();
          this.anchorMode = 1;
          this.update();
        } else if (bound(BATCH_SHORTCUT_IDS.anchorEnd, keyboard)) {
          event.preventDefault();
          this.anchorMode = 2;
          this.update();
        }
      },
      true,
    );
    scope.listen(window, "keyup", (event: Event) => {
      const keyboard = event as KeyboardEvent;
      if (
        this.anchorMode !== 0 &&
        (releasedBinding(BATCH_SHORTCUT_IDS.anchorStart, keyboard) ||
          releasedBinding(BATCH_SHORTCUT_IDS.anchorEnd, keyboard))
      ) {
        this.anchorMode = 0;
        this.update();
      }
    });
    scope.listen(window, "blur", () => this.cancel());
  }

  signature(area: TimelineArea, session: EditorSession): string {
    return batchSelectionSignature(area, session);
  }

  panelBounds(area: TimelineArea, lineIndex: number, canvas: HTMLCanvasElement): Bounds {
    const width = canvas.clientWidth;
    const panelWidth = this.timeline.viewport.panelWidth(width, area);
    const left =
      this.timeline.viewport.panelIndex(lineIndex, area) *
        this.timeline.viewport.panelStride(width, area) -
      this.timeline.viewport.multiLineViewportOffset(width, area);
    return { left, right: left + panelWidth, width: panelWidth };
  }

  selectionBounds(
    area: TimelineArea,
    snapshot: SelectionSnapshot,
    canvas: HTMLCanvasElement,
  ): Bounds {
    return selectionPanelBounds(area, snapshot, (lineIndex) =>
      this.panelBounds(area, lineIndex, canvas),
    );
  }

  clampPoint(point: Point, bounds: Bounds, canvas: HTMLCanvasElement): Point {
    return {
      x: Math.max(-canvas.clientWidth, Math.min(canvas.clientWidth * 2, point.x)),
      y: Math.max(-canvas.clientHeight, Math.min(canvas.clientHeight * 2, point.y)),
    };
  }

  sync(): void {
    const session = this.getSession();
    if (
      this.active &&
      (session !== this.active.session ||
        session.chart !== this.active.snapshot.chart ||
        this.signature(this.active.area, session) !== this.active.signature ||
        !this.enabled())
    ) {
      this.cancel();
    }
    const stage = this.stage.getBoundingClientRect();
    for (const [area, group] of this.groups) {
      const multiSelection =
        area === "notes"
          ? [...(session.multiLineSelection?.values() ?? [])].reduce(
              (sum, values) => sum + values.size,
              0,
            )
          : [...(session.multiEventSelection?.values() ?? [])].reduce(
              (sum, values) => sum + values.size,
              0,
            );
      const selection =
        area === "notes"
          ? multiSelection + session.selection.size
          : multiSelection + session.eventSelection.size;
      const multiMode =
        session.multiLineActive &&
        ((area === "notes" && session.multiLineMode === "notes") ||
          (area === "events" && session.multiLineMode === "events"));
      const multiIntent = session.multiSelectionIntent === area;
      const canShow =
        area === "events"
          ? // Event bars are no longer draggable themselves, so even one selected
            // event needs the three control balls to move or resize it.
            selection > 0 && !(session.multiLineActive && session.multiLineMode === "notes")
          : multiMode
            ? multiSelection > 0 && multiIntent
            : selection >= 2 || (selection > 0 && multiIntent);
      const visible = this.enabled() && canShow;
      this.state.presentations.update({
        ...this.state.presentations.get(),
        [area]: {
          visible,
          left: group.left ?? "",
          top: group.top ?? "",
        },
      });
      if (this.active || !visible) {
        continue;
      }
      const canvas = area === "notes" ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
      const rectangle = canvas.getBoundingClientRect();
      if (!rectangle.width) {
        this.state.presentations.update({
          ...this.state.presentations.get(),
          [area]: {
            visible: false,
            left: group.left ?? "",
            top: group.top ?? "",
          },
        });
        continue;
      }
      const signature = `${this.signature(area, session)}:${rectangle.width}:${rectangle.height}`;
      if (signature === group.signature) {
        continue;
      }
      group.signature = signature;
      const point =
        area === "notes" ? this.timeline.gestures.cursor : this.timeline.gestures.eventCursor;
      const bounds = this.selectionBounds(area, captureSelection(session), canvas);
      const requested = Math.max(
        bounds.left + 20,
        Math.min(bounds.right - 26, (point?.x ?? bounds.left + bounds.width / 2) + 50),
      );
      const horizontal = Math.max(8, Math.min(rectangle.width - 26, requested));
      const vertical = Math.max(
        25,
        Math.min(rectangle.height - 97, (point?.y ?? rectangle.height / 2) - 30),
      );
      group.left = `${rectangle.left - stage.left + horizontal}px`;
      group.top = `${rectangle.top - stage.top + vertical}px`;
      this.state.presentations.update({
        ...this.state.presentations.get(),
        [area]: {
          visible: true,
          left: group.left,
          top: group.top,
        },
      });
    }
  }

  down(event: PointerEvent, area: TimelineArea, kind: string, button: HTMLButtonElement): void {
    if (event.button !== 0 || this.active || !this.enabled()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cancelledPointerCapture = null;
    // The native pointer can cross the canvas while the control ball owns capture. Do not let
    // that unrelated position becomes the next paste target when this batch proposal ends.
    this.timeline.gestures.clipboardPointer = null;
    const session = this.getSession();
    const snapshot = captureSelection(session);
    const selectedEntries = area === "notes" ? snapshot.notes : snapshot.events;
    const multiMode =
      session.multiLineActive &&
      ((area === "notes" && session.multiLineMode === "notes") ||
        (area === "events" && session.multiLineMode === "events"));
    const multiIntent = session.multiSelectionIntent === area;
    // Event balls are the only way to move or resize an event, so one selected
    // event is enough. Notes keep their batch threshold.
    const minimumEntries =
      area === "events"
        ? 1
        : multiMode
          ? multiIntent
            ? 1
            : Number.POSITIVE_INFINITY
          : multiIntent
            ? 1
            : 2;
    if (selectedEntries.length < minimumEntries) {
      return;
    }
    if (area === "notes") {
      snapshot.events = [];
    } else {
      snapshot.notes = [];
    }
    this.timeline.cancelPlacement();
    for (const animation of button.getAnimations()) {
      animation.cancel();
    }
    const group = button.parentElement ?? button;
    for (const animation of group.getAnimations()) {
      animation.cancel();
    }
    group.style.transform = "";
    const canvas = area === "notes" ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
    const rawPoint = this.timeline.viewport.point(event, canvas);
    const bounds = this.selectionBounds(area, snapshot, canvas);
    const firstEntry = (area === "notes" ? snapshot.notes : snapshot.events)[0];
    const activeLineIndex = Number.isInteger(firstEntry?.lineIndex)
      ? firstEntry.lineIndex
      : session.lineIndex;
    const point = this.clampPoint(rawPoint, bounds, canvas);
    const spec = controlsByKind.get(kind);
    this.active = {
      session,
      snapshot,
      kind,
      button,
      group,
      label: spec ? t(spec.label ?? spec.title) : kind,
      area,
      lineIndex: activeLineIndex,
      bounds,
      signature: this.signature(area, session),
      pointerId: event.pointerId,
      start: point,
      point,
      canvas,
      unit: Math.max(0.35, canvas.clientHeight / 1080),
      factor: session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1,
      startBeat: this.timeline.viewport.tempo.beat(
        this.timeline.viewport.tempo.seconds(
          this.timeline.viewport.origin,
          session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1,
        ) +
          (canvas.clientHeight - (this.timeline.viewport.judgementOffset ?? 42) - point.y) /
            this.timeline.viewport.scaleForArea(area),
        session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1,
      ),
      startX:
        typeof this.timeline.viewport.notePositionAt === "function"
          ? this.timeline.viewport.notePositionAt(point.x, activeLineIndex)
          : point.x,
    };
    this.timeline.gestures.scaleAxis =
      kind === "note-scale" ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.gestures.scaleAxisLine = kind === "note-scale" ? activeLineIndex : null;
    button.setPointerCapture(event.pointerId);
    this.timeline.changed();
  }

  move(event: PointerEvent): void {
    if (!this.active || event.pointerId !== this.active.pointerId) {
      return;
    }
    event.preventDefault();
    this.active.point = this.clampPoint(
      this.timeline.viewport.point(event, this.active.canvas),
      this.active.bounds,
      this.active.canvas,
    );
    this.update();
  }

  update(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const { point, start, kind, snapshot, factor } = active;
    this.timeline.gestures.scaleAxis =
      kind === "note-scale" ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.gestures.scaleAxisLine = kind === "note-scale" ? active.lineIndex : null;
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;
    // Move the whole control group directly on the pointer path. The frame/HUD
    // cadence is intentionally independent of pointer feedback, so React state
    // and the 12 Hz HUD refresh must not be part of this visual loop.
    active.group.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    const panelWidth =
      active.area === "notes"
        ? (this.timeline.viewport.panelWidth?.(active.canvas.clientWidth, "notes") ??
          active.canvas.clientWidth)
        : 0;
    const deltas = batchDragDeltas({
      tempo: this.timeline.viewport.tempo,
      origin: this.timeline.viewport.origin,
      scale: this.timeline.viewport.scaleForArea(active.area),
      judgementOffset: this.timeline.viewport.judgementOffset ?? 42,
      division: this.timeline.viewport.division,
      height: active.canvas.clientHeight,
      start,
      point,
      factor,
      startBeat: active.startBeat,
      factorForLine: (lineIndex) =>
        this.timeline.viewport.factorForLine?.(lineIndex) ?? active.factor,
      lineIndices: (active.area === "notes" ? snapshot.notes : snapshot.events).map(
        (entry: { lineIndex: number }) => entry.lineIndex,
      ),
      panelWidth,
      inset: active.area === "notes" ? (this.timeline.viewport.noteInset?.(panelWidth) ?? 0) : 0,
      unit: active.unit,
      notes: active.area === "notes",
    });
    const result = controlSelection(snapshot, kind, {
      ...deltas,
      anchorMode: this.anchorMode,
      snapX: this.timeline.viewport.snapX,
      gridCount: this.timeline.viewport.gridCount,
    });
    active.result = result;
    // Publish the proposal instead of cloning the session: the timeline draws it for as long
    // as the pointer is down, and `up()` either commits it to `active.session` or `cancel()`
    // drops it. Built from `active.session` — the live document, not the current preview.
    const preview = previewSession(active.session, result);
    this.timeline.setPreview(preview);
    this.state.hints.set(
      active.area,
      result.lineIndex !== snapshot.lineIndex
        ? t("editorPanels.batch.control.lineChange", {
            from: snapshot.lineIndex,
            to: result.lineIndex,
          })
        : kind === "note-scale"
          ? t("editorPanels.batch.control.horizontalScale")
          : "",
    );
    this.timeline.changed();
  }

  up(event: PointerEvent): void {
    const active = this.active;
    if (!active) {
      const cancelled = this.cancelledPointerCapture;
      if (cancelled?.pointerId === event.pointerId) {
        this.cancelledPointerCapture = null;
        if (cancelled.button.hasPointerCapture(cancelled.pointerId)) {
          cancelled.button.releasePointerCapture(cancelled.pointerId);
        }
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.pointerId !== active.pointerId) {
      return;
    }
    this.move(event);
    this.timeline.gestures.clipboardPointer = null;
    this.timeline.setPreview(null);
    this.timeline.gestures.scaleAxis = null;
    this.timeline.gestures.scaleAxisLine = null;
    try {
      if (Math.hypot(active.point.x - active.start.x, active.point.y - active.start.y) > 3) {
        if (
          this.getSession() !== active.session ||
          active.session.chart !== active.snapshot.chart ||
          this.signature(active.area, active.session) !== active.signature
        ) {
          throw new Error(t("editorPanels.batch.control.selectionChanged"));
        }
        const result = active.result;
        if (result) {
          this.active = null;
          commitSelectionEdit(
            active.session,
            result,
            t("editorPanels.batch.control.commit", { action: active.label }),
            {},
            { normalized: true },
          );
          this.onCommit?.();
        }
      }
    } catch (error) {
      this.reportError(error);
    }
    this.active = null;
    this.returnBall(active);
    // Releasing pointer capture can synchronously expose the pointer to the notes canvas.
    // Clear the paste target after release as well, so the committed frame cannot use a
    // pointer position captured while the batch proposal was active.
    this.timeline.gestures.clipboardPointer = null;
    this.timeline.changed();
  }

  returnBall(active: ActiveBatch, releasePointerCapture = true): void {
    if (releasePointerCapture && active.button.hasPointerCapture(active.pointerId)) {
      active.button.releasePointerCapture(active.pointerId);
    }
    const group = this.groups.get(active.area);
    if (!group) {
      return;
    }
    const rectangle = active.canvas.getBoundingClientRect();
    group.signature = `${this.signature(active.area, this.getSession())}:${rectangle.width}:${rectangle.height}`;
    this.state.hints.set(active.area, "");
    const deltaX = active.point.x - active.start.x;
    const deltaY = active.point.y - active.start.y;
    active.group.style.transform = "";
    // A larger ease-out exponent pulls the ball home through the middle of the
    // animation instead of letting it hover near the dock for the last second.
    const returnCoefficient = 3;
    const frames = Array.from({ length: 61 }, (unused, index) => {
      const remaining = (1 - index / 60) ** returnCoefficient;
      return {
        transform: `translate(${deltaX * remaining}px, ${deltaY * remaining}px)`,
        offset: index / 60,
      };
    });
    active.group.animate(frames, { duration: 1600 });
  }

  cancel(preservePointerCapture = false): void {
    const active = this.active;
    if (!active) {
      return;
    }
    this.active = null;
    this.cancelledPointerCapture = preservePointerCapture
      ? { button: active.button, pointerId: active.pointerId }
      : null;
    this.timeline.gestures.clipboardPointer = null;
    this.timeline.setPreview(null);
    this.timeline.gestures.scaleAxis = null;
    this.timeline.gestures.scaleAxisLine = null;
    this.returnBall(active, !preservePointerCapture);
    if (!preservePointerCapture) {
      this.timeline.gestures.clipboardPointer = null;
    }
    this.timeline.changed();
  }

  dispose(): void {
    const active = this.active;
    if (active?.button.hasPointerCapture(active.pointerId)) {
      active.button.releasePointerCapture(active.pointerId);
    }
    this.active = null;
    this.cancelledPointerCapture = null;
    this.timeline.gestures.clipboardPointer = null;
    this.timeline.setPreview(null);
    this.timeline.gestures.scaleAxis = null;
    this.timeline.gestures.scaleAxisLine = null;
    this.state.actions.set(null);
  }
}
