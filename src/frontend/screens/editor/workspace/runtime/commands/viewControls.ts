/**
 * The editor's view controls: region visibility, multi-line mode, preview
 * options, and the commands that change them. Display defaults live in settings;
 * this module owns the runtime cells and command wiring.
 */
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { createValue } from "../../../../../../core/state/values.ts";
import { TOOLBAR_REFRESH_EVENT } from "../../../../../../core/shell/shellEventNames.ts";
import {
  editorMultiLineActive,
  editorMultiLineMerge,
  editorMultiLineMode,
} from "../../../../../../core/edit/state/publishedValues.ts";
import type { Preview } from "../../preview/scene/preview.ts";
import { createLateBound } from "../../../../../../core/utils/lateBound.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { createEditorModeHistory, type EditorModeSnapshot } from "./modeHistory.ts";

/** The regions the stage can show and the multi-line state applied to them. */
export type EditorRegionSnapshot = {
  showNotes: boolean;
  showEvents: boolean;
  showPreview: boolean;
  multiLineActive: boolean;
  multiLineMode: "notes" | "events";
  multiLineMerge: boolean;
};

/** The authoring timeline that a view command can reveal. */
export type EditorTimelineMode = "notes" | "events";
/**
 * Whether the stage currently shows a note or event surface beside the preview.
 *
 * Multi-line editing chooses which one of those surfaces is drawn, but it does
 * not force the authoring area open: hiding both regions leaves the preview
 * alone, which is how a selection can be used only for batch properties.
 */
export function showsAuthoringRegion(regions: EditorRegionSnapshot): boolean {
  return !curvePreviewMode.get() && (regions.showNotes || regions.showEvents);
}
const regionValues = [
  displayValues.showNotes,
  displayValues.showEvents,
  displayValues.previewEnabled,
];

/** The canonical preview layout used when no earlier complete layout exists. */
const PREVIEW_LAYOUT: EditorModeSnapshot = {
  showNotes: false,
  showEvents: false,
  showPreview: true,
};

/** Runtime-only preview focus; it never enters persisted display settings. */
const previewOnly = createValue<boolean>({ initial: false });

/** The layout a held preview audition must restore when its key is released. */
interface PreviewOnlyHold {
  raw: EditorModeSnapshot;
  focused: boolean;
}

/** Reads the complete raw region state that a preview shortcut must restore. */
function readModeSnapshot(): EditorModeSnapshot {
  return {
    showNotes: displayValues.showNotes.get(),
    showEvents: displayValues.showEvents.get(),
    showPreview: displayValues.previewEnabled.get(),
  };
}

/** Whether a raw snapshot already has no authoring region to focus. */
function isPreviewFallbackSnapshot(snapshot: EditorModeSnapshot): boolean {
  return !snapshot.showNotes && !snapshot.showEvents;
}

/** Applies a complete raw region snapshot without creating a new history entry. */
function applyModeSnapshot(snapshot: EditorModeSnapshot): void {
  displayValues.showNotes.set(snapshot.showNotes);
  displayValues.showEvents.set(snapshot.showEvents);
  displayValues.previewEnabled.set(snapshot.showPreview);
}
/** Derives the effective region flags from the persisted switches and editor mode. */
function readRegions(): EditorRegionSnapshot {
  // Single-line editing keeps the three switches independent. In multi-line
  // mode the two authoring regions become one exclusive choice, but each field's
  // own switch still hides it: turning the active field off leaves the preview
  // as the workspace fallback. The raw switches return unchanged when multi-line
  // editing ends.
  const focused = previewOnly.get();
  const multiLineActive = editorMultiLineActive.get();
  const multiLineMode = editorMultiLineMode.get();
  const notesEnabled = displayValues.showNotes.get();
  const eventsEnabled = displayValues.showEvents.get();
  return {
    showNotes: !focused && notesEnabled && (!multiLineActive || multiLineMode === "notes"),
    showEvents: !focused && eventsEnabled && (!multiLineActive || multiLineMode === "events"),
    showPreview: focused || displayValues.previewEnabled.get(),
    multiLineActive,
    multiLineMode,
    multiLineMerge: editorMultiLineMerge.get(),
  };
}

/**
 * The preview underlay is the workspace's fallback surface. Its own switch is
 * independent, but when both authoring regions are off the stage must still
 * show something, so the preview stays visible while its switch remains off.
 */
export function previewVisibleForRegions(regions: EditorRegionSnapshot): boolean {
  return regions.showPreview || (!regions.showNotes && !regions.showEvents);
}
const regions = createValue<EditorRegionSnapshot>({ initial: readRegions() });
/** The latest effective region snapshot. */
export const getEditorRegionSnapshot = regions.get;
/** Subscribes to effective region changes. */
export const subscribeToEditorRegions = regions.subscribe;
/** Recomputes the snapshot and notifies the toolbar when it changed identity. */
function refreshRegions(): void {
  const before = regions.get();
  regions.update(readRegions());
  if (regions.get() !== before && typeof window !== "undefined") {
    window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
  }
}
/**
 * Re-enables the field a multi-line mode change selects.
 *
 * The region buttons may hide the active field, but switching modes is a
 * request to see that field; the preview stays the fallback only while both
 * switches remain off.
 */
function revealMultiLineField(): void {
  if (!editorMultiLineActive.get()) {
    return;
  }
  if (editorMultiLineMode.get() === "notes") {
    displayValues.showNotes.set(true);
  } else {
    displayValues.showEvents.set(true);
  }
}
for (const value of regionValues) {
  value.subscribeKey(refreshRegions);
}
previewOnly.subscribe(refreshRegions);
editorMultiLineMode.subscribeKey(revealMultiLineField);
editorMultiLineActive.subscribeKey(refreshRegions);
editorMultiLineMode.subscribeKey(refreshRegions);
editorMultiLineMerge.subscribeKey(refreshRegions);
/** Services the view commands write through. */
export interface EditorViewControlRuntime {
  realtimePreview: Pick<Preview, "visible" | "showGameUI">;
  applyDisplaySettings(): void;
  persist(): void;
  invalidate(): void;
  getSession(): EditorSession;
  /** Writes `editor.realtimePreviewEnabled`; applying it is the editor's subscription. */
  setRealtimePreviewEnabled(enabled: boolean): void;
}

/** Owns display-region and camera controls. */
export function createEditorViewControls(
  runtime: EditorViewControlRuntime,
  options: { now?: () => number } = {},
) {
  const modeHistory = createEditorModeHistory(readModeSnapshot(), PREVIEW_LAYOUT);
  const now = options.now ?? Date.now;

  /** Records the final state of one user-visible region command. */
  function recordModeChange(): void {
    modeHistory.observe(readModeSnapshot(), now());
  }

  /**
   * The region flags are values, so the classes follow a write on their own; what is
   * left for the caller is the relayout such a change needs.
   */
  function applyRegionVisibility(): void {
    runtime.realtimePreview.visible =
      previewVisibleForRegions(getEditorRegionSnapshot()) || curvePreviewMode.get();
    window.dispatchEvent(new Event("resize"));
    runtime.invalidate();
  }

  let previewOnlyHold: PreviewOnlyHold | null = null;

  /** Lets an explicit layout command take ownership from an audition hold. */
  function cancelPreviewOnlyHold(): void {
    previewOnlyHold = null;
  }

  /** Focuses the preview for a held audition without recording a mode change. */
  function beginPreviewOnlyHold(): void {
    if (previewOnlyHold !== null) {
      return;
    }
    previewOnlyHold = { raw: readModeSnapshot(), focused: previewOnly.get() };
    previewOnly.set(true);
    applyRegionVisibility();
  }

  /** Restores the layout captured when a held audition started. */
  function endPreviewOnlyHold(): void {
    if (previewOnlyHold === null) {
      return;
    }
    const hold = previewOnlyHold;
    previewOnlyHold = null;
    applyModeSnapshot(hold.raw);
    previewOnly.set(hold.focused);
    applyRegionVisibility();
  }

  /** Materializes the effective preview-only view before another view command edits it. */
  function materializePreviewOnly(): void {
    if (!previewOnly.get()) {
      return;
    }
    cancelPreviewOnlyHold();
    const effective = regions.get();
    displayValues.showNotes.set(effective.showNotes);
    displayValues.showEvents.set(effective.showEvents);
    displayValues.previewEnabled.set(effective.showPreview);
    previewOnly.set(false);
  }

  /**
   * Toggles one authoring region, or selects it as the multi-line field.
   *
   * Multi-line editing shows one field at a time, but pressing the active
   * field's button still hides it. Switching to the other field enables that
   * field, so a mode change never selects a hidden surface.
   */
  function toggleRegion(region: "showNotes" | "showEvents"): void {
    materializePreviewOnly();
    const session = runtime.getSession();
    const value = region === "showNotes" ? displayValues.showNotes : displayValues.showEvents;
    if (session.multiLineActive) {
      const mode = region === "showNotes" ? "notes" : "events";
      if (session.multiLineMode === mode) {
        value.set(!value.get());
      } else {
        value.set(true);
        session.setMultiLineMode(mode);
      }
    } else {
      value.set(!value.get());
    }
    recordModeChange();
    applyRegionVisibility();
    runtime.persist();
  }

  /** Toggles both authoring regions as one visibility command. */
  function toggleRegions(): void {
    materializePreviewOnly();
    const session = runtime.getSession();
    if (session.multiLineActive) {
      // The pair cannot be shown together in multi-line editing. Both switches
      // are enabled for single-line mode while the current field stays on screen.
      displayValues.showNotes.set(true);
      displayValues.showEvents.set(true);
    } else {
      const showBoth = !displayValues.showNotes.get() || !displayValues.showEvents.get();
      displayValues.showNotes.set(showBoth);
      displayValues.showEvents.set(showBoth);
    }
    recordModeChange();
    applyRegionVisibility();
    runtime.persist();
  }

  /** Centers the chart camera, optionally restoring the default view divisor. */
  function resetCamera(resetPreview = false): void {
    displayValues.cameraX.set("0");
    if (resetPreview) {
      displayValues.viewDivisor.set("1");
    }
    runtime.applyDisplaySettings();
    runtime.persist();
  }

  /** Toggles the preview's game-UI overlay. */
  function toggleGameUi(): void {
    displayValues.showGameUI.set(!runtime.realtimePreview.showGameUI);
    runtime.applyDisplaySettings();
    runtime.persist();
  }

  /** The preview's own switch; hiding it never changes the authoring regions. */
  function toggleStagePreview(): void {
    if (previewOnly.get()) {
      cancelPreviewOnlyHold();
      previewOnly.set(false);
      applyRegionVisibility();
      return;
    }
    runtime.setRealtimePreviewEnabled(!displayValues.previewEnabled.get());
    recordModeChange();
  }

  /**
   * Toggles the runtime preview-only overlay. If the raw layout is already a
   * preview fallback, Ctrl+Space instead restores the last complete snapshot.
   */
  function togglePreviewOnly(): void {
    modeHistory.flush();
    if (previewOnly.get()) {
      cancelPreviewOnlyHold();
      previewOnly.set(false);
    } else if (isPreviewFallbackSnapshot(readModeSnapshot())) {
      const swapped = modeHistory.swap();
      if (swapped !== null) {
        applyModeSnapshot(swapped);
      }
    } else {
      previewOnly.set(true);
    }
    applyRegionVisibility();
  }

  /** Reveal one ordinary authoring timeline on the current judge line. */
  function showSingleTimeline(mode: EditorTimelineMode): void {
    const session = runtime.getSession();
    if (!session.chart.judgeLineList?.length) {
      return;
    }
    cancelPreviewOnlyHold();
    previewOnly.set(false);
    session.setMultiLineEnabled(false, mode);
    session.setMultiLineSelection([session.lineIndex]);
    displayValues.showNotes.set(mode === "notes");
    displayValues.showEvents.set(mode === "events");
    recordModeChange();
    applyRegionVisibility();
    runtime.persist();
  }

  /** Collapse multi-line editing into the current line's ordinary note timeline. */
  function showSingleNoteTimeline(): void {
    showSingleTimeline("notes");
  }

  /** Collapse multi-line editing into the current line's ordinary event timeline. */
  function showSingleEventTimeline(): void {
    showSingleTimeline("events");
  }

  /** Applies a `width:height` preview ratio and persists its two fields. */
  function setPreviewRatio(value: string): void {
    const [width, height] = value.split(":").map(Number);
    displayValues.ratioWidth.set(String(width));
    displayValues.ratioHeight.set(String(height));
    runtime.applyDisplaySettings();
    runtime.persist();
  }

  return {
    applyRegionVisibility,
    beginPreviewOnlyHold,
    endPreviewOnlyHold,
    toggleRegion,
    toggleRegions,
    resetCamera,
    toggleGameUi,
    toggleStagePreview,
    togglePreviewOnly,
    showSingleTimeline,
    showSingleNoteTimeline,
    showSingleEventTimeline,
    setPreviewRatio,
  };
}

// -------------------------------------------------------------------- the view

const viewControlsBinding = createLateBound<ReturnType<typeof createEditorViewControls>>();

/**
 * Hands the mounted editor's display owners to the commands below. The region
 * flags, camera, game UI, and preview are reached through the same functions
 * from the View menu, toolbar switches, and editor subscriptions.
 */
export function connectViewControls(runtime: EditorViewControlRuntime): () => void {
  const controls = createEditorViewControls(runtime);
  return viewControlsBinding.bind(controls);
}

/** The display commands, as the menu and the toolbar's switches see them. */
export const viewControls = Object.freeze({
  applyRegionVisibility: (): void => viewControlsBinding.value()?.applyRegionVisibility(),
  beginPreviewOnlyHold: (): void => viewControlsBinding.value()?.beginPreviewOnlyHold(),
  endPreviewOnlyHold: (): void => viewControlsBinding.value()?.endPreviewOnlyHold(),
  toggleRegion: (region: "showNotes" | "showEvents"): void =>
    viewControlsBinding.value()?.toggleRegion(region),
  toggleRegions: (): void => viewControlsBinding.value()?.toggleRegions(),
  resetCamera: (resetPreview = false): void =>
    viewControlsBinding.value()?.resetCamera(resetPreview),
  toggleGameUi: (): void => viewControlsBinding.value()?.toggleGameUi(),
  toggleStagePreview: (): void => viewControlsBinding.value()?.toggleStagePreview(),
  togglePreviewOnly: (): void => viewControlsBinding.value()?.togglePreviewOnly(),
  showSingleTimeline: (mode: EditorTimelineMode): void =>
    viewControlsBinding.value()?.showSingleTimeline(mode),
  showSingleNoteTimeline: (): void => viewControlsBinding.value()?.showSingleNoteTimeline(),
  showSingleEventTimeline: (): void => viewControlsBinding.value()?.showSingleEventTimeline(),
  setPreviewRatio: (value: string): void => viewControlsBinding.value()?.setPreviewRatio(value),
});

// ------------------------------------------------------------------- ratios

/**
 * The aspect ratios the preview panel offers.
 *
 * This is the preset table behind `editor.previewRatio`: the toolbar dropdown
 * reads it, and `setPreviewRatio` parses the same strings. A ratio not in the
 * table is appended by the dropdown so the current value stays selectable.
 */
export const SCREEN_RATIOS = ["4:3", "3:2", "16:9"];
