/**
 * Renders and edits trajectory presets for the current event selection.
 *
 * The panel owns field layout, preview sampling, and command dispatch, while
 * curve math and chart event construction remain in core. It does not own
 * selection or create a second trajectory state store.
 */
import { flushSync } from "react-dom";
import {
  TRAJECTORY_DEFAULTS,
  sampleCurveTrajectory,
  editableTrajectoryOptions,
  type CurvePreset,
  type TrajectorySample,
  type ValidatedCurvePreset,
} from "../../../../../core/global/chart/trajectory/curveTrajectory.ts";
import {
  createTrajectoryEvent,
  generateTrajectoryChart,
  splitTrajectoryChart,
} from "../../../../../core/edit/events/trajectoryCommands.ts";
import { clamp01 } from "../../../../../core/utils/numbers.ts";
import { beatCopy, type Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { SceneRuntime, type LineState } from "../../../../../core/global/chart/runtime/scene.ts";
import type { Chart, JudgeLineEvent } from "../../../../../core/global/chart/chart.ts";
import {
  DEFAULT_PREVIEW_ASPECT_RATIO,
  previewViewport,
} from "../../workspace/preview/scene/viewport.ts";
import { prepareCanvas } from "../../canvas/canvas2d.ts";
import { readCanvasPalette } from "../../canvas/palette.ts";
import { canvasFont } from "../../canvas/text.ts";
import {
  trajectorySplitSettings,
  type TrajectorySplitSettings,
} from "../../../../../core/global/chart/trajectory/trajectorySimplify.ts";
import { t } from "../../../../../i18n/index.ts";
import {
  parseCurvePreset,
  parseCurvePresets,
} from "../../../../../core/global/chart/trajectory/trajectoryPresets.ts";
import {
  drawPath,
  errorMessage,
  presetStorage,
  STORAGE_KEY,
  type PresetDraft,
  type TrajectoryContext,
  type TrajectoryEvent,
  type TrajectoryOptionBag,
  type TrajectoryPanelHooks,
  type TrajectoryPreviewRenderer,
  type TrajectoryTickResult,
} from "./trajectoryPanelControls.ts";
import { TrajectoryPanelView } from "./TrajectoryPanelView.tsx";
import { buildTrajectoryPreview } from "./trajectoryPreview.ts";
import type { TrajectoryPanelState } from "./model.ts";
import {
  createTrajectoryPresetCallbacks,
  type TrajectoryPresetCallbacks,
} from "./trajectoryPresetActions.ts";

/** Trajectory pane model: form state, preview sampling, and apply/split commands. */
export class TrajectoryPanel {
  declare state: TrajectoryPanelState;
  // `declare` fields are assigned by the constructor or methods; this adds types only.
  declare getContext: () => TrajectoryContext;
  declare invalidate: () => void;
  declare notify: (message: string, severity?: string) => void;
  declare setOverlayVisible: (visible: boolean) => void;
  declare activate: (pane: "" | "trajectory") => void;
  declare options: TrajectoryOptionBag;
  declare segments: number;
  declare splitSettings: TrajectorySplitSettings;
  declare startTime: Beat;
  declare endTime: Beat;
  declare enabled: boolean;
  declare animate: boolean;
  declare overlay: HTMLCanvasElement;
  declare custom: ValidatedCurvePreset[];
  declare active?: boolean;
  declare editing: JudgeLineEvent | null;
  declare presetDraft: PresetDraft | null;
  declare lineIndex: number;
  declare layerIndex: number;
  declare replace?: boolean;
  declare canvas: HTMLCanvasElement;
  declare message: HTMLParagraphElement;
  declare status: string;
  declare statusError: boolean;
  declare applyDisabled: boolean;
  declare viewRevision: number;
  declare fieldsRevision: number;
  declare optionsRevision: number;
  declare presetCallbacks: TrajectoryPresetCallbacks;
  declare customSource?: string;
  declare customEditingName: string | null;
  declare customMessage: string;
  declare customHasError: boolean;
  declare customCopyVisible: boolean;
  declare customActionsDisabled: boolean;
  declare customOpen: boolean;
  declare customScrollRevision: number;
  declare openCategory: string | null;
  declare openCategoryRevision: number;
  declare baseChart: Chart | null;
  declare event: TrajectoryEvent | null;
  declare points: TrajectorySample[] | null;
  declare previewChart: Chart | null;
  declare scene?: SceneRuntime | null;
  declare beginSeconds: number;
  declare endSeconds: number;
  declare worldPoints: Array<LineState | undefined> | null;

  /** Binds the panel to the overlay canvas and host callbacks. */
  constructor(
    overlay: HTMLCanvasElement,
    getContext: () => TrajectoryContext,
    {
      invalidate,
      notify,
      activate,
      setOverlayVisible,
      state,
    }: TrajectoryPanelHooks & { state: TrajectoryPanelState },
  ) {
    this.getContext = getContext;
    this.state = state;
    this.invalidate = invalidate;
    this.notify = notify;
    this.activate = activate;
    this.setOverlayVisible = setOverlayVisible;
    this.options = structuredClone(TRAJECTORY_DEFAULTS);
    this.segments = 128;
    this.splitSettings = trajectorySplitSettings();
    this.startTime = [1, 0, 1];
    this.endTime = [5, 0, 1];
    this.enabled = true;
    this.animate = true;
    this.status = "";
    this.statusError = false;
    this.applyDisabled = false;
    this.viewRevision = 0;
    this.fieldsRevision = 0;
    this.optionsRevision = 0;
    this.overlay = overlay;
    this.custom = [];
    this.customEditingName = null;
    this.customMessage = "";
    this.customHasError = false;
    this.customCopyVisible = false;
    this.customActionsDisabled = true;
    this.customOpen = false;
    this.customScrollRevision = 0;
    this.openCategory = null;
    this.openCategoryRevision = 0;
    this.presetCallbacks = createTrajectoryPresetCallbacks(this);
    this.custom = parseCurvePresets(presetStorage.getItem(STORAGE_KEY));
  }

  /** Opens the pane for a new trajectory or an existing move event. */
  open(event: JudgeLineEvent | null = null, lineIndex?: number, layerIndex?: number): void {
    const { session, timeline } = this.getContext();
    this.active = true;
    this.editing = event;
    this.presetDraft = null;
    // A new trajectory lands on the line and layer selected in the editor; the
    // panel has no target fields of its own. Editing an existing one keeps the
    // target it was opened from, so it can be rewritten in place.
    if (event) {
      this.lineIndex = lineIndex ?? session.lineIndex;
      this.layerIndex = layerIndex ?? Math.min(3, timeline.gestures.layer);
    } else {
      this.syncTarget();
    }
    if (event) {
      const trajectory = event.trajectory;
      if (trajectory) {
        this.options = editableTrajectoryOptions(trajectory.options);
        this.segments = trajectory.segments ?? 128;
        this.splitSettings = trajectorySplitSettings(trajectory.split);
      }
      this.startTime = beatCopy(event.startTime);
      this.endTime = beatCopy(event.endTime);
    }
    this.render();
    this.activate("trajectory");
    this.refresh();
  }

  /** Deactivates the pane and hides its canvas overlay. */
  hide(): void {
    this.active = false;
    this.setOverlayVisible(false);
    this.previewChart = null;
  }

  /** Hides the pane and clears its published snapshot. */
  dispose(): void {
    this.hide();
    this.state.set(null);
  }

  /** Drops preview data that belonged to the previous document. */
  clearDocument(): void {
    this.scene?.clear();
    this.previewChart = null;
    this.worldPoints = [];
    this.editing = null;
  }

  /** Seeds the custom-preset source and republishes the form. */
  render(): void {
    this.customSource ??= JSON.stringify(
      {
        name: t("editorPanels.trajectory.myTrajectory"),
        mode: "parametric",
        xExpression: "radius*cos(2*pi*t)",
        yExpression: "radius*sin(2*pi*t)",
        parameters: [
          {
            key: "radius",
            label: t("editorPanels.trajectory.sampleRadiusLabel"),
            value: 200,
            min: 1,
            max: 2000,
            step: 1,
          },
        ],
      },
      null,
      2,
    );
    this.viewRevision += 1;
    this.validateCustom();
    this.renderPresets(true);
  }

  /** Publishes the current form and preset state; `sync` flushes before returning. */
  renderPresets(sync = false): void {
    const presets = {
      custom: this.custom,
      customSource: this.customSource ?? "",
      customEditingName: this.customEditingName,
      customMessage: this.customMessage,
      customHasError: this.customHasError,
      customCopyVisible: this.customCopyVisible,
      customActionsDisabled: this.customActionsDisabled,
      customOpen: this.customOpen,
      customScrollRevision: this.customScrollRevision,
      openCategory: this.openCategory,
      openCategoryRevision: this.openCategoryRevision,
      ...this.presetCallbacks,
    };
    const publish = () =>
      this.state.set({
        component: TrajectoryPanelView,
        revision: this.viewRevision,
        props: {
          startTime: this.startTime,
          endTime: this.endTime,
          options: this.options,
          segments: this.segments,
          splitSettings: this.splitSettings,
          replace: this.replace,
          enabled: this.enabled,
          animate: this.animate,
          editing: Boolean(this.editing),
          status: this.status,
          statusError: this.statusError,
          applyDisabled: this.applyDisabled,
          fieldsRevision: this.fieldsRevision,
          optionsRevision: this.optionsRevision,
          statusRef: (element) => {
            if (element) {
              this.message = element;
            }
          },
          previewCanvasRef: (element) => {
            if (element) {
              this.canvas = element;
            }
          },
          onFieldsChange: (values) => this.onFieldsInput(values),
          onEnabledChange: (value) => {
            this.enabled = value;
            this.renderPresets();
            this.invalidate();
          },
          onAnimateChange: (value) => {
            this.animate = value;
            this.renderPresets();
            this.invalidate();
          },
          onApply: () => this.apply(),
          onSplit: () => this.split(),
          presets,
        },
      });
    if (sync) {
      flushSync(publish);
    } else {
      publish();
    }
  }

  /** Copies edited form values into the panel model and refreshes the preview. */
  onFieldsInput(values: Record<string, unknown>): void {
    try {
      this.startTime = values.startTime as Beat;
      this.endTime = values.endTime as Beat;
      this.segments = values.segments as number;
      this.replace = values.replace as boolean;
      this.splitSettings = trajectorySplitSettings({
        simplify: values.simplify as boolean,
        tolerance: values.tolerance as number,
      });
      this.options = {
        ...values,
        parameters: JSON.parse(String(values.parametersJson)),
      } as TrajectoryOptionBag;
      for (const key of [
        "startTime",
        "endTime",
        "segments",
        "replace",
        "parametersJson",
        "simplify",
        "tolerance",
      ]) {
        delete this.options[key];
      }
      this.presetDraft = null;
      this.refresh();
    } catch (error) {
      this.error(error);
    }
  }

  /** Loads a preset into the custom source editor. */
  loadCustom(preset: CurvePreset | ValidatedCurvePreset, originalName: string | null = null): void {
    this.customEditingName = originalName;
    this.customSource = JSON.stringify(preset, null, 2);
    this.customOpen = true;
    this.customScrollRevision += 1;
    this.validateCustom();
    this.renderPresets();
  }

  /** Shows a custom-preset error in the editor. */
  customError(error: unknown): void {
    this.customOpen = true;
    this.customHasError = true;
    this.customActionsDisabled = true;
    this.customMessage = errorMessage(error);
    this.customScrollRevision += 1;
    this.renderPresets();
  }

  /** Re-parses the custom source and updates its editor state. */
  validateCustom(): void {
    const source = this.customSource ?? "";
    try {
      const preset = parseCurvePreset(source);
      this.customCopyVisible =
        Boolean(this.customEditingName) || this.custom.some((entry) => entry.name === preset.name);
      this.customMessage = this.customEditingName
        ? t("editorPanels.trajectory.editingHint", { name: this.customEditingName })
        : t("editorPanels.trajectory.draftHint", {
            button: t("editorPanels.trajectory.addCustom"),
          });
      this.customHasError = false;
      this.customActionsDisabled = false;
    } catch (error) {
      this.customMessage = errorMessage(error);
      this.customHasError = true;
      this.customActionsDisabled = true;
    }
    this.renderPresets();
  }

  /** Publishes a pane-level error and disables applying. */
  error(error: unknown): void {
    this.status = errorMessage(error);
    this.statusError = true;
    this.previewChart = null;
    this.points = null;
    this.worldPoints = null;
    this.applyDisabled = true;
    this.renderPresets();
    this.invalidate();
  }

  /** Points a new trajectory at the line and layer the editor has selected. */
  private syncTarget(): void {
    const { session, timeline } = this.getContext();
    this.lineIndex = session.lineIndex;
    this.layerIndex = Math.min(3, timeline.gestures.layer);
  }

  /** Rebuilds the preview chart, samples, and status from the current options. */
  refresh(): void {
    if (!this.active) {
      return;
    }
    if (!this.editing) {
      this.syncTarget();
    }
    try {
      const { session } = this.getContext();
      this.baseChart = session.chart;
      const options = this.presetDraft?.options ?? this.options;
      const event = createTrajectoryEvent(
        options,
        this.startTime,
        this.endTime,
        this.segments,
        this.splitSettings,
      );
      this.event = event;
      const points = sampleCurveTrajectory(options, 257);
      this.points = points;
      // Preview and Apply read the same replace flag. When a non-replace range
      // is occupied, the helper still returns a drawable path but reports the
      // conflict so the footer can disable Apply before the user tries it.
      const preview = buildTrajectoryPreview(
        session.chart,
        this.lineIndex,
        this.layerIndex,
        event,
        this.editing,
        this.replace === true,
      );
      const previewChart = preview.chart;
      this.previewChart = previewChart;
      const scene = new SceneRuntime();
      this.scene = scene;
      scene.compile(previewChart, this.getContext().tempo);
      const { tempo } = this.getContext();
      this.beginSeconds = tempo.seconds(this.startTime);
      this.endSeconds = tempo.seconds(this.endTime);
      this.worldPoints = points.map(
        (point, index) =>
          scene.sample(
            this.beginSeconds +
              ((this.endSeconds - this.beginSeconds) * index) / (points.length - 1),
          )[this.lineIndex],
      );
      this.status = preview.occupied
        ? t("editor.commands.trajectoryCommands.error.occupiedRange")
        : this.presetDraft
          ? t("editorPanels.trajectory.draftPreviewMessage")
          : t("editorPanels.trajectory.readyMessage");
      this.statusError = preview.occupied;
      this.applyDisabled = Boolean(this.presetDraft) || preview.occupied;
      this.renderPresets();
      this.invalidate();
    } catch (error) {
      this.error(error);
    }
  }

  /** Writes the current trajectory into the chart as a move event. */
  apply(): void {
    try {
      const { session } = this.getContext();
      if (this.presetDraft) {
        throw new Error(t("editorPanels.trajectory.fillFirst"));
      }
      // A create writes into whatever is selected at the moment it is applied.
      if (!this.editing) {
        this.syncTarget();
      }
      const event = createTrajectoryEvent(
        this.options,
        this.startTime,
        this.endTime,
        this.segments,
        this.splitSettings,
      );
      const chart = generateTrajectoryChart(
        session.chart,
        this.lineIndex,
        this.layerIndex,
        event,
        this.editing,
        this.replace === true,
      );
      this.editing = null;
      session.focus = "events";
      session.eventLayer = this.layerIndex;
      session.selection.clear();
      session.eventSelection = new Set();
      session.commitChart(t("editorPanels.trajectory.commitGenerate"), chart);
      this.renderPresets();
      this.refresh();
      this.notify(t("editorPanels.trajectory.generated"), "success");
    } catch (error) {
      this.error(error);
    }
  }

  /** Replaces the edited event with its simplified segments. */
  split(): void {
    try {
      const { session } = this.getContext();
      const editing = this.editing;
      if (!editing) {
        throw new Error(t("editorPanels.trajectory.needEvent"));
      }
      const chart = splitTrajectoryChart(session.chart, this.lineIndex, this.layerIndex, editing, {
        ...this.splitSettings,
        segments: this.segments,
      });
      this.editing = null;
      session.eventSelection.clear();
      session.multiEventSelection.clear();
      session.commitChart(t("editorPanels.trajectory.commitSplit"), chart);
      this.activate("");
      this.notify(t("editorPanels.trajectory.splitDone"), "success");
    } catch (error) {
      this.error(error);
    }
  }

  /** Draws one preview frame and returns the chart the stage should render. */
  tick(
    timestamp: number,
    seconds: number,
    playing: boolean,
    renderer: TrajectoryPreviewRenderer,
  ): TrajectoryTickResult | null {
    if (!this.active) {
      return null;
    }
    if (!this.editing) {
      // Follow the editor's line/layer selection while the panel is open, so the
      // preview and the overlay annotation agree with where Apply will write.
      const { session, timeline } = this.getContext();
      const lineIndex = session.lineIndex;
      const layerIndex = Math.min(3, timeline.gestures.layer);
      if (lineIndex !== this.lineIndex || layerIndex !== this.layerIndex) {
        this.lineIndex = lineIndex;
        this.layerIndex = layerIndex;
        this.refresh();
      }
    }
    if (this.baseChart !== this.getContext().session.chart) {
      const editing = this.editing;
      if (editing) {
        const selected = (this.getContext().session.chart.judgeLineList ?? [])
          .flatMap((line) => (line.eventLayers ?? []).flatMap((layer) => layer?.moveXEvents ?? []))
          .find((event) => event.trajectory === editing.trajectory);
        if (selected) {
          this.editing = selected;
          this.startTime = selected.startTime;
          this.endTime = selected.endTime;
          this.fieldsRevision += 1;
          this.renderPresets();
        } else {
          this.editing = null;
          this.renderPresets();
        }
      }
      this.refresh();
    }
    const progress =
      playing || !this.animate
        ? clamp01((seconds - this.beginSeconds) / (this.endSeconds - this.beginSeconds))
        : (timestamp / 2500) % 1;
    drawPath(this.canvas, this.points, progress);
    if (this.presetDraft) {
      drawPath(this.presetDraft.canvas, this.presetDraft.points, progress);
    }
    const worldPoints = this.worldPoints;
    const overlayVisible = Boolean(
      this.enabled && worldPoints && !this.getContext().previewVisible,
    );
    this.setOverlayVisible(overlayVisible);
    if (overlayVisible && worldPoints) {
      const palette = readCanvasPalette();
      const { context, width, height } = prepareCanvas(this.overlay);
      const viewport = previewViewport(
        width,
        height,
        renderer.aspectRatio ?? DEFAULT_PREVIEW_ASPECT_RATIO,
      );
      const divisor = renderer.viewDivisor ?? 1;
      const scaleX = viewport.scaleX / divisor;
      const scaleY = viewport.scaleY / divisor;
      const centerX = viewport.left + viewport.width / 2;
      const centerY = viewport.top + viewport.height / 2;
      context.save();
      context.beginPath();
      context.rect(viewport.left, viewport.top, viewport.width, viewport.height);
      context.clip();
      context.strokeStyle = palette.inspectorMarker;
      context.lineWidth = 2;
      context.globalAlpha = 0.8;
      context.beginPath();
      const screen = (point: LineState): [number, number] => [
        centerX + point.x * scaleX,
        centerY - point.y * scaleY,
      ];
      worldPoints.forEach((point, index) =>
        point
          ? index
            ? context.lineTo(...screen(point))
            : context.moveTo(...screen(point))
          : undefined,
      );
      context.stroke();
      const marker =
        worldPoints[
          Math.min(worldPoints.length - 1, Math.floor(progress * (worldPoints.length - 1)))
        ];
      if (marker) {
        context.fillStyle = palette.inspectorMarker;
        context.beginPath();
        context.arc(...screen(marker), 6, 0, Math.PI * 2);
        context.fill();
      }
      context.font = canvasFont("body");
      context.fillText(
        t("editorPanels.trajectory.overlayLabel", { index: this.lineIndex }),
        18 + viewport.left,
        24 + viewport.top,
      );
      context.restore();
    }
    return this.enabled && this.previewChart
      ? {
          chart: this.previewChart,
          seconds:
            playing || !this.animate
              ? seconds
              : this.beginSeconds + (this.endSeconds - this.beginSeconds) * progress,
        }
      : null;
  }
}
