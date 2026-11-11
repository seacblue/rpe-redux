/**
 * The transient session batch controls draw while a drag is still a proposal.
 * The batch controller owns the proposal; this adapter only gives timeline
 * readers a real session shape instead of a parallel model.
 */
import { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { SelectionEditResult } from "../../../../../../core/edit/selection/edits.ts";

/**
 * Builds the transient session that batch controls draw while a drag is still a proposal.
 *
 * Batch controls own this adapter because it is presentation state for their drag preview,
 * not a timeline primitive. The returned session is real so timeline readers keep their
 * normal session contract without casts or a second lookalike model.
 */
export function previewSession(live: EditorSession, result: SelectionEditResult): EditorSession {
  const preview = new EditorSession(result.chart);

  // What the proposal changes.
  // Keep the same current-line rule as commitSelectionEdit: a multi-line move
  // keeps the live line as the editing context, even though the proposal's
  // selected notes may now live on another line. This matters to line-relative
  // viewport geometry; using result.lineIndex here makes preview and commit use
  // different panel coordinates for the same chart.
  const hasMultiSelection =
    (result.multiLineSelection?.size ?? 0) > 0 || (result.multiEventSelection?.size ?? 0) > 0;
  preview.lineIndex = live.multiLineActive && hasMultiSelection ? live.lineIndex : result.lineIndex;
  preview.selection = result.selection;
  preview.eventSelection = result.eventSelection;
  // A single-line drag carries no multi-line maps; keep the live ones so a multi-line
  // selection stays visible instead of blanking out mid-drag. The edit result types those
  // maps as Iterable because it only ever walks them, while a session hands them to code
  // that calls Set methods, so they are copied into real sets.
  preview.multiLineSelection = result.multiLineSelection
    ? new Map([...result.multiLineSelection].map(([line, indices]) => [line, new Set(indices)]))
    : live.multiLineSelection;
  preview.multiEventSelection = result.multiEventSelection
    ? new Map([...result.multiEventSelection].map(([line, values]) => [line, new Set(values)]))
    : live.multiEventSelection;

  // What the drawing and hit tests read but the proposal does not change. These are the
  // batch controls' read surface: multi-line mode and merge policy decide which panels are
  // drawn, and focus/eventLayer decide which area is being edited.
  preview.multiLineEnabled = live.multiLineEnabled;
  preview.multiLineIndices = live.multiLineIndices;
  preview.multiLineMode = live.multiLineMode;
  preview.multiLineMerge = live.multiLineMerge;
  preview.focus = live.focus;
  preview.selectionMode = live.selectionMode;
  preview.eventLayer = live.eventLayer;
  preview.multiSelectionIntent = live.multiSelectionIntent;
  preview.clipboard = live.clipboard;
  preview.clipboardNoteLines = live.clipboardNoteLines;
  preview.eventClipboard = live.eventClipboard;
  preview.eventClipboardLines = live.eventClipboardLines;
  preview.eventClipboardLayers = live.eventClipboardLayers;
  preview.eventClipboardPreserveLayers = live.eventClipboardPreserveLayers;
  preview.cutDensity = live.cutDensity;
  preview.division = live.division;
  preview.eventWheelSteps = live.eventWheelSteps;
  preview.shaderAutoAlign = live.shaderAutoAlign;
  preview.liveBeatEdit = live.liveBeatEdit;
  preview.liveEventEdit = live.liveEventEdit;
  preview.noteDraftActive = live.noteDraftActive;
  preview.visibleTimeUnit = live.visibleTimeUnit;

  return preview;
}
