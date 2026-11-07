/**
 * The editor's registered toolbar controls.
 *
 * Region, division, grid, Extension, and noise entries are contributed here in
 * row order rather than drawn by the frame. Playback and audition are shared
 * chrome controls; `transportControlNode` supplies those.
 */
import type { ComponentType, ReactNode } from "react";
import {
  toolbar,
  type ToolbarControl,
  type ToolbarEntry,
} from "../../../../core/shell/registries/toolbar.ts";
import { PLAYBACK_RATES } from "../../../../core/edit/playback/rates.ts";
import {
  editorDivision,
  editorGridCount,
  editorLine,
  editorLineNavigationDisabled,
  editorLineOptions,
  editorLineSelection,
  editorPreviewRatio,
  editorRate,
} from "../../../../core/edit/state/publishedValues.ts";
import { parseLineSelectionInput } from "../../../../core/edit/state/lineSelectionInput.ts";
import { commitTimelineNumeric } from "./timelineControls.ts";
import { SCREEN_RATIOS, viewControls } from "../workspace/runtime/commands/viewControls.ts";
import { getEditorRegionSnapshot } from "../workspace/runtime/commands/viewControls.ts";
import { transportControlNode } from "../../../chrome/transport/TransportControls.tsx";
import { ExtensionPicker } from "./ExtensionPicker.tsx";
import { NoiseRenderingToggle } from "./NoiseRenderingToggle.tsx";
import { freeCameraState, toggleFreeCamera } from "../workspace/stage/freeCamera/freeCamera.ts";

/**
 * Register the editor's two toolbar rows.
 *
 * Registration returns a disposer for hot module replacement. Each row is a list
 * of contributions in `order`; a field entry names the value it shows, and a
 * command entry names the action it runs.
 */
export function registerToolbarControls(): () => void {
  const remove = ROW_ONE.map((entry) => toolbar.register(entry));
  remove.push(...ROW_TWO.map((entry) => toolbar.register(entry)));
  return () => remove.forEach((dispose) => dispose());
}

/**
 * Controls that subscribe to values, mounted as components so their hooks stay
 * in their own fiber as the toolbar's entry list changes.
 */
const CONTROL_RENDERERS: Record<string, ComponentType> = {
  extensions: ExtensionPicker,
  noiseRendering: NoiseRenderingToggle,
};

/** Render one registered toolbar control, preferring a shared chrome node. */
export function toolbarControlNode(entry: ToolbarControl): ReactNode {
  const shared = transportControlNode(entry);
  if (shared) {
    return shared;
  }
  const Control = CONTROL_RENDERERS[entry.controlId];
  return Control ? <Control /> : null;
}

/**
 * Parse a typed line value against the document's available line indices.
 *
 * The toolbar picker and the multi-line selector share `editor.lineOptions`, so
 * both accept exactly the lines the document can show.
 */
function readLineInput(raw: string) {
  return parseLineSelectionInput(
    raw,
    editorLineOptions.get().map((option) => option.index),
  );
}

/** Whether a typed value names at least one line the document contains. */
function isEditorLineIndex(raw: string): boolean {
  return readLineInput(raw) !== null;
}

/** The transport row: transport, then the editor's own fields. */
const ROW_ONE: readonly ToolbarEntry[] = [
  { kind: "divider", id: "toolbar.rule.line", order: 30, row: 1 },
  {
    kind: "field",
    field: "number",
    id: "toolbar.line",
    domId: "line-input",
    row: 1,
    order: 40,
    dropdown: "linePicker",
    icon: "pencil",
    className: "line-field",
    min: 0,
    // The maximum follows the document's last line; the field never sizes itself.
    max: () => {
      const options = editorLineOptions.get();
      return options.length ? options[options.length - 1].index : 0;
    },
    disabled: () => editorLineNavigationDisabled.get(),
    label: "chrome.toolbar.lineField",
    tipTitle: "chrome.toolbar.lineField",
    value: "editor.lineInput",
    // Typed text stays in the box until commit: a line the document lacks is
    // parsed when the field loses focus. Ranges and unions are selections, not
    // one line, so `2:5` selects those four lines and jumps to the first.
    text: true,
    textAlign: "center",
    accept: isEditorLineIndex,
    commitOnBlur: true,
    // Arrow keys step one line at a time and apply at once.
    input: (raw) => {
      const parsed = readLineInput(raw);
      if (!parsed) {
        return;
      }
      editorLine.set(String(parsed.line));
    },
    commit: (raw) => {
      const parsed = readLineInput(raw);
      if (!parsed) {
        return;
      }
      // The finished field is the selection, not a hint added to the old one:
      // typing `2` after `2-3` leaves only line 2 selected.
      editorLine.set(String(parsed.line));
      editorLineSelection.set(parsed.lines);
    },
  },
  { kind: "divider", id: "toolbar.rule.subdivision", order: 50, row: 1 },
  {
    kind: "field",
    field: "number",
    id: "toolbar.division",
    domId: "division",
    row: 1,
    order: 60,
    icon: "linesHorizontal",
    className: "division-field",
    min: 1,
    max: 100,
    textAlign: "center",
    label: "chrome.toolbar.division",
    tipTitle: "chrome.toolbar.division",
    tipDesc: "chrome.toolbar.divisionHint",
    value: "editor.division",
    input: (value) => editorDivision.set(value),
    commit: (value) => commitTimelineNumeric("division", value),
  },
  { kind: "divider", id: "toolbar.rule.rate", order: 70, row: 1 },
  {
    kind: "field",
    field: "select",
    id: "toolbar.rate",
    domId: "rate",
    row: 1,
    order: 80,
    className: "rate-field",
    icon: "rate",
    tipTitle: "chrome.time.rate",
    value: "editor.rate",
    options: () => PLAYBACK_RATES,
    commit: (value) => editorRate.set(value),
  },
  {
    kind: "control",
    id: "toolbar.extensions",
    order: 90,
    row: 1,
    controlId: "extensions",
  },
];

/**
 * The view row: what the stage shows, then how it is drawn.
 *
 * The region toggles run editor actions like every other command: the id is only
 * the element the row draws, never a second name for the behavior.
 */
const ROW_TWO: readonly ToolbarEntry[] = [
  {
    kind: "action",
    id: "stage.notes",
    domId: "stage-notes",
    group: "regions",
    order: 10,
    row: 2,
    icon: "layers",
    label: "chrome.toolbar.region.notes",
    tooltip: "chrome.toolbar.region.notes",
    checked: () => getEditorRegionSnapshot().showNotes,
    run: () => viewControls.toggleRegion("showNotes"),
  },
  {
    kind: "action",
    id: "stage.events",
    domId: "stage-events",
    group: "regions",
    order: 12,
    row: 2,
    icon: "bezier",
    label: "chrome.toolbar.region.events",
    tooltip: "chrome.toolbar.region.events",
    checked: () => getEditorRegionSnapshot().showEvents,
    run: () => viewControls.toggleRegion("showEvents"),
  },
  {
    kind: "action",
    id: "stage.preview",
    domId: "stage-preview",
    group: "regions",
    order: 14,
    row: 2,
    icon: "preview",
    label: "chrome.toolbar.region.preview",
    tooltip: "chrome.toolbar.region.preview",
    checked: () => getEditorRegionSnapshot().showPreview,
    run: () => viewControls.toggleStagePreview(),
  },
  // The region toggles lead row two; the grid and ratio fields follow them.
  { kind: "divider", id: "toolbar.rule.gridCount", order: 30, row: 2 },
  {
    kind: "field",
    field: "number",
    id: "toolbar.gridCount",
    domId: "grid-count",
    row: 2,
    order: 40,
    icon: "linesVertical",
    className: "grid-count-field",
    min: 1,
    max: 100,
    step: "any",
    textAlign: "center",
    label: "chrome.toolbar.gridCount",
    tipTitle: "chrome.toolbar.gridCount",
    tipDesc: "chrome.toolbar.gridCountHint",
    value: "editor.gridCount",
    input: (value) => editorGridCount.set(value),
    commit: (value) => commitTimelineNumeric("gridCount", value),
  },
  { kind: "divider", id: "toolbar.rule.ratio", order: 50, row: 2 },
  {
    kind: "field",
    field: "select",
    id: "toolbar.ratio",
    domId: "preview-ratio",
    row: 2,
    order: 60,
    icon: "aspect",
    className: "ratio-field",
    tipTitle: "chrome.toolbar.ratio",
    value: "editor.previewRatio",
    // A document carrying a ratio outside the presets keeps its own entry, so
    // the list always shows what the preview is actually using.
    options: (value) => (SCREEN_RATIOS.includes(value) ? SCREEN_RATIOS : [...SCREEN_RATIOS, value]),
    commit: (value) => editorPreviewRatio.set(value),
  },
  {
    kind: "action",
    id: "editor.free-camera",
    domId: "free-camera",
    group: "view",
    order: 70,
    row: 2,
    icon: "zoom",
    label: "chrome.toolbar.freeCamera",
    tooltip: "chrome.toolbar.freeCameraHint",
    description: "chrome.toolbar.freeCameraHint",
    checked: () => freeCameraState.get().active,
    run: toggleFreeCamera,
  },
];
