/**
 * Owns the editor's cross-surface input bindings.
 *
 * This is a runtime subsystem, not a bag of callbacks: it installs the value,
 * menu, toolbar, clipboard, and keyboard bindings as one disposable unit.  The
 * mount root supplies the live editor services explicitly; replaceable document
 * state is represented by getters at this seam.
 */
import type { AudioTransport } from "../../../../../../core/media/audio.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { EditorPlayback } from "../../../../../../core/edit/playback/transport.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { Preview } from "../../preview/scene/preview.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { LineSwitcher } from "../../timeline/lineSwitcher/lineSwitcher.ts";
import type { AudioAnalysis } from "../../timeline/audioAnalysis/audioAnalysis.ts";
import type { EditorKeyboardBindingDependencies } from "../../../../../platform/shortcuts/editorKeyboard.ts";
import { LINE_JUMP_SHORTCUT_ID } from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import type { PrefixDigitSequenceSubmission } from "../../../../../../core/shortcuts/prefixDigitSequence.ts";
import type { CanvasShortcutTarget } from "../../../../../platform/shortcuts/canvasShortcuts.ts";
import type { EditorSettingsBindings } from "../../../../settings/editorRuntime.ts";
import type { HistoryTravelOptions } from "../../../../../../core/edit/operations/editing.ts";
import {
  editorLine,
  editorLineInput,
  editorLineSelection,
  editorPreviewRatio,
  editorRealtimePreviewEnabled,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { formatLineSelection } from "../../../../../../core/edit/state/lineSelectionInput.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import {
  bindPlaybackControls,
  bindEditorPlaybackValues,
} from "../../../../../../core/edit/bindings/playbackSettings.ts";
import {
  connectEditing,
  createHistoryTravel,
} from "../../../../../../core/edit/operations/editing.ts";
import { bindTimelineControlInputs } from "../../../toolbar/timelineControls.ts";
import { registerEditorKeyboardBindings } from "../../../../../platform/shortcuts/editorKeyboard.ts";
import { samplingActive, startSamplingForSelection } from "../../../sampling/samplingSession.ts";
import { claimCurveDraftShortcut } from "../../../curveEvents/undo.ts";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { deleteCurveSelectionAction } from "../../../curveEvents/store.ts";
import { createEditorSettingsBindings } from "../../../../settings/editorRuntime.ts";
import { connectViewControls, viewControls } from "../commands/viewControls.ts";
import { createClipboardCommands } from "./clipboardCommands.ts";
import { selectEventLayer } from "../../timeline/layers/layerButtons.ts";
import { registerLineActions } from "../../../../global/sections/lines/lineActions.ts";
import {
  setProgressSeekHandler,
  type ProgressState,
} from "../../../../../chrome/transport/chartProgressState.ts";

type CurveEditorBinding = {
  updatePanel(): void;
  capture(endAnchor: boolean): void;
  resetDraft(): void;
};

type LineInfoBinding = {
  hide(): void;
  toggle(): void;
};

type BatchControlsBinding = {
  active?: unknown;
};

interface EditorBindingRuntime {
  scope: ResourceScope;
  getSession(): EditorSession;
  persistEditor(): void;
  invalidate(): void;
  atHome(): boolean;
  hasDocument(): boolean;
  canvasTarget(event: Event): CanvasShortcutTarget | null;
  activeCanvasTarget(): CanvasShortcutTarget | null;
  clearCanvasTarget(): void;
  currentBeat(): number;
  seekBeat(beat: number, pause?: boolean): void;
  save(): Promise<unknown>;
  reportError(error: unknown): void;
  notify: HistoryTravelOptions["notify"];
  /** Commit a passive judge-line prefix gesture. */
  lineJump(submission: PrefixDigitSequenceSubmission): void;
}

interface EditorBindingTimeline {
  timeline: Timeline;
  audioAnalysis: AudioAnalysis;
  lineSwitcher: Pick<LineSwitcher, "step">;
  eventInteraction: EditorKeyboardBindingDependencies["eventInteraction"];
  progress: ProgressState;
}

interface EditorBindingPlayback {
  audio: EditorSettingsBindings["audio"] & Pick<AudioTransport, "setRate">;
  hitSounds: EditorSettingsBindings["hitSounds"];
  realtimePreview: Preview;
  playback: Pick<EditorPlayback, "seek">;
  togglePlayback(): Promise<unknown>;
}

interface EditorBindingEditing {
  linePanel: {
    commit(label: string, chart: Chart, index?: number): void;
  };
  curveEditor: CurveEditorBinding;
  batchControls: BatchControlsBinding;
  lineInfo: LineInfoBinding;
  selectionClipboard: Parameters<typeof createClipboardCommands>[0]["selectionClipboard"];
  openMultiLinePanel(): void;
  showLineInfo(): void;
  resetCamera(): void;
  toggleGameUi(): void;
  closePane(): void;
}

/** Services and feature handles needed to install the editor's input bindings. */
export interface EditorBindingDependencies {
  runtime: EditorBindingRuntime;
  timeline: EditorBindingTimeline;
  playback: EditorBindingPlayback;
  editing: EditorBindingEditing;
}

/** Install all editor input surfaces and return the settings applier. */
export function bindEditorInteractions(groups: EditorBindingDependencies) {
  // Flatten once here; the public seam stays grouped by capability.
  const deps = { ...groups.runtime, ...groups.timeline, ...groups.playback, ...groups.editing };
  const setRealtimePreviewEnabled = (enabled: boolean) => {
    editorRealtimePreviewEnabled.set(enabled);
  };
  deps.scope.add(
    bindTimelineControlInputs({
      timeline: deps.timeline,
      getSession: deps.getSession,
      updateCurvePanel: deps.curveEditor.updatePanel,
      persistEditor: deps.persistEditor,
      invalidate: deps.invalidate,
    }),
  );
  // The field is the one place the toolbar shows the line set; multi-line
  // selections are written in their compact form (`0-2,5`).
  const syncLineInput = () => {
    const selection = editorLineSelection.get();
    editorLineInput.set(selection.length > 1 ? formatLineSelection(selection) : editorLine.get());
  };
  deps.scope.add(
    editorLine.subscribeKey(() => {
      syncLineInput();
      const index = Number(editorLine.get());
      const session = deps.getSession();
      if (index === session.lineIndex) {
        return;
      }
      // The active line is navigation. It is independent of the shared line
      // list: Ctrl+wheel, the overview and the field only move this number.
      deps.timeline.cancelPlacement();
      session.selectLine(index);
    }),
  );
  deps.scope.add(
    editorLineSelection.subscribeKey(() => {
      syncLineInput();
      const session = deps.getSession();
      const next = editorLineSelection.get();
      if (
        next.length === session.multiLineIndices.length &&
        next.every((index, position) => index === session.multiLineIndices[position])
      ) {
        return;
      }
      const wasActive = session.multiLineActive;
      // A list of two or more lines is the multi-line mode. The first time the
      // set grows, choose the field the workspace is actually showing so the
      // selected lines appear where the user is working.
      session.setMultiLineSelection(next);
      if (!wasActive && session.multiLineActive) {
        const notes = displayValues.showNotes.get();
        const events = displayValues.showEvents.get();
        // Preserve the last chosen mode when both fields are visible; only an
        // exclusive field decides the mode for the user.
        if (!notes && events) {
          session.setMultiLineMode("events");
        } else if (notes && !events) {
          session.setMultiLineMode("notes");
        }
      }
      deps.invalidate();
    }),
  );
  deps.scope.add(
    editorRealtimePreviewEnabled.subscribeKey(() => {
      const enabled = editorRealtimePreviewEnabled.get();
      // The switch and the painted surface are not the same thing: with both
      // authoring regions hidden the preview remains the workspace fallback even
      // while its own switch stays off.
      deps.realtimePreview.visible =
        enabled || (!displayValues.showNotes.get() && !displayValues.showEvents.get());
      displayValues.previewEnabled.set(enabled);
      viewControls.applyRegionVisibility();
      deps.persistEditor();
      deps.invalidate();
    }),
  );
  deps.scope.add(bindEditorPlaybackValues({ audio: deps.audio, invalidate: deps.invalidate }));
  deps.scope.add(setProgressSeekHandler(deps.progress, (seconds) => deps.playback.seek(seconds)));
  deps.scope.add(
    bindPlaybackControls({
      setVolume: deps.audio.setVolume,
      setHitSoundVolume: deps.hitSounds.setSoundVolume,
      setRealtimeAlpha: (value) => {
        deps.realtimePreview.opacity = value;
      },
      invalidate: deps.invalidate,
    }),
  );
  const historyTravel = createHistoryTravel({
    getSession: deps.getSession,
    cancelPlacement: () => deps.timeline.cancelPlacement(),
    notify: deps.notify,
  });
  const settingsBindings = createEditorSettingsBindings({
    getSession: deps.getSession,
    audio: deps.audio,
    hitSounds: deps.hitSounds,
    realtimePreview: deps.realtimePreview,
    timeline: deps.timeline,
    audioAnalysis: deps.audioAnalysis,
    invalidate: deps.invalidate,
    addCleanup: (cleanup) => deps.scope.add(cleanup),
  });
  const { copySelection, copySelectionAllLayers, deleteSelection, cutSelection, pasteSelection } =
    createClipboardCommands({
      selectionClipboard: deps.selectionClipboard,
    });
  deps.scope.add(
    connectEditing({
      historyTravel,
      copy: copySelection,
      cut: cutSelection,
      paste: pasteSelection,
      remove: deleteSelection,
    }),
  );
  deps.scope.add(
    registerLineActions({
      getSession: deps.getSession,
      hasDocument: deps.hasDocument,
      commit: (label, chart, index) => deps.linePanel.commit(label, chart, index),
    }),
  );
  registerEditorKeyboardBindings({
    scope: deps.scope,
    batchControlsActive: () => Boolean(deps.batchControls.active),
    canvasTarget: deps.canvasTarget,
    activeCanvasTarget: deps.activeCanvasTarget,
    clearCanvasTarget: deps.clearCanvasTarget,
    curveModeActive: () => curvePreviewMode.get(),
    samplingActive,
    hideLineInfo: deps.lineInfo.hide,
    invalidate: deps.invalidate,
    claimDraftShortcut: claimCurveDraftShortcut,
    getSession: deps.getSession,
    timeline: deps.timeline,
    eventInteraction: deps.eventInteraction,
    save: deps.save,
    travel: (direction) => historyTravel.travel(direction),
    copySelection,
    copySelectionAllLayers,
    cutSelection,
    pasteSelection,
    selectEventLayer: (layer) => selectEventLayer(deps.timeline, deps.getSession(), layer),
    togglePlayback: deps.togglePlayback,
    showLineInfo: deps.showLineInfo,
    sampleSelection: () => startSamplingForSelection(deps.getSession()),
    resetCamera: deps.resetCamera,
    toggleGameUi: deps.toggleGameUi,
    togglePreviewOnly: () => viewControls.togglePreviewOnly(),
    openMultiLinePanel: deps.openMultiLinePanel,
    captureCurve: deps.curveEditor.capture,
    deleteSelection,
    deleteCurveSelection: deleteCurveSelectionAction,
    currentBeat: deps.currentBeat,
    seekBeat: deps.seekBeat,
    stepLine: (direction) => deps.lineSwitcher.step(direction) !== false,
    reportError: deps.reportError,
    prefixDigitShortcut: {
      id: LINE_JUMP_SHORTCUT_ID,
      submit: deps.lineJump,
    },
  });
  deps.scope.add(
    connectViewControls({
      realtimePreview: deps.realtimePreview,
      applyDisplaySettings: () => settingsBindings.applySettings(),
      persist: deps.persistEditor,
      invalidate: deps.invalidate,
      getSession: deps.getSession,
      setRealtimePreviewEnabled,
    }),
  );
  deps.scope.add(
    editorPreviewRatio.subscribeKey(() => viewControls.setPreviewRatio(editorPreviewRatio.get())),
  );
  return settingsBindings;
}
