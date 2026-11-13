/**
 * Draws the note field: backdrop grid, note bars and holds, selection state,
 * lane labels, multi-line panels, and the playhead.
 *
 * It owns canvas painting; note filtering, geometry, and hit rules come from core
 * and the viewport.
 */
import { noteAlpha } from "../../../../../../core/global/chart/optionalFeatures.ts";
import { prepareCanvas } from "../../../canvas/canvas2d.ts";
import { noteSkewAtHit, noteSkewCurve, noteSkewShear } from "../../../canvas/noteGeometry.ts";
import {
  BACKGROUND_GRID,
  FOREGROUND_GRID,
  PLAYHEAD_GRID,
  strokeVerticalGrid,
} from "../drawing/gridDrawing.ts";
import {
  noteColor,
  readCanvasPalette,
  remoteSelectionHighlightColor,
  selectionHighlightColor,
  type CanvasPalette,
} from "../../../canvas/palette.ts";
import { notePaintLayer } from "../../../canvas/noteSpriteGroups.ts";
import { canvasFont } from "../../../canvas/text.ts";
import { TimelineLabelCuller } from "../drawing/labelCulling.ts";
import { multiLineLineOpacity } from "../multiLine/multiLinePresentation.ts";
import {
  checkedNote,
  checkedNotes,
  isTimelineNoteRenderable,
  timelineRenderRangeInto,
  type TimelineRenderRange,
} from "../../../../../../core/edit/timeline/model.ts";
import type { TimelineNote } from "../../../../../../core/edit/timeline/types.ts";
import type {
  TimelineNoteDrawingReceiver,
  TimelinePlayheadDrawingReceiver,
} from "../drawing/timelineReceiver.ts";
import { drawEventOverlapFilter } from "../events/eventSelectionDrawing.ts";
import { selectedNoteIndices } from "./noteSelectionDrawing.ts";
import { noteOverlapRotation } from "./noteRotation.ts";
import { drawNoteLanes } from "./noteLaneDrawing.ts";

interface MultiLineNoteScratch {
  readonly lineLabelCuller: TimelineLabelCuller;
  readonly range: TimelineRenderRange;
}

const multiLineNoteScratch = new WeakMap<object, MultiLineNoteScratch>();

/** Reuse multi-line label and range storage across timeline frames. */
function multiLineNoteScratchFor(receiver: object): MultiLineNoteScratch {
  const existing = multiLineNoteScratch.get(receiver);
  if (existing) {
    return existing;
  }
  const created: MultiLineNoteScratch = {
    lineLabelCuller: new TimelineLabelCuller(),
    range: { start: 0, end: 0, invalid: false },
  };
  multiLineNoteScratch.set(receiver, created);
  return created;
}

interface NotePaintOptions {
  /** Palette resolved once for the enclosing draw pass. */
  palette: CanvasPalette;
  note: TimelineNote;
  horizontal: number;
  vertical: number;
  endVertical: number;
  noteWidth: number;
  height: number;
  opacityMultiplier?: number;
  /** Render the note body in the editor's selected-note colour. */
  selected?: boolean;
  /** Render the note body in the collaboration tint for another member's selection. */
  remoteSelected?: boolean;
  /** Horizontal shear from the line's sampled skew, matching the preview. */
  shear?: number;
  /** In-place rotation for one note of a same-beat overlap stack. */
  rotation?: number;
}

/** Create a note projection that reuses the frame's origin lookup. */
interface NoteProjection {
  /** Frame factor for the line; also keys the prepared render data. */
  readonly factor: number;
  /** Project chart seconds onto the note field. */
  project(seconds: number): number;
}

/** Resolve the frame-invariant note projection inputs for one line. */
function noteProjectionFor(
  receiver: Pick<TimelineNoteDrawingReceiver, "cache" | "viewport">,
  lineIndex: number,
  height: number,
): NoteProjection {
  const factor = receiver.viewport.noteFactorForLine(lineIndex);
  const originSeconds = receiver.cache.tempoSeconds(
    receiver.viewport.tempo,
    receiver.viewport.origin,
    factor,
  );
  const scale = receiver.viewport.scaleForArea("notes");
  const judgementOffset = receiver.viewport.judgementOffset;
  return {
    factor,
    project: (seconds) => height - judgementOffset - (seconds - originSeconds) * scale,
  };
}

/** Create a beat projection that reuses the frame's origin lookup. */
function cachedNoteVerticalProjection(
  receiver: Pick<TimelineNoteDrawingReceiver, "cache" | "viewport">,
  lineIndex: number,
  height: number,
): (beat: number) => number {
  const projection = noteProjectionFor(receiver, lineIndex, height);
  return (beat) =>
    projection.project(
      receiver.cache.tempoSeconds(receiver.viewport.tempo, beat, projection.factor),
    );
}

/** Paint one note for both the normal and multi-line timelines. */
export function drawNote(
  this: TimelineNoteDrawingReceiver,
  context: CanvasRenderingContext2D,
  options: NotePaintOptions,
): void {
  const { note, horizontal, vertical, endVertical, noteWidth, height } = options;
  const { palette } = options;
  const alpha =
    noteAlpha(note) * (this.appearance.noteOpacity ?? 1) * (options.opacityMultiplier ?? 1);
  const shear = note.type === 2 ? 0 : (options.shear ?? 0);
  const rotation = note.type === 2 ? 0 : (options.rotation ?? 0);
  context.globalAlpha = alpha;
  const selected = options.selected === true;
  const remoteSelected = !selected && options.remoteSelected === true;
  const selectionTint = selected
    ? selectionHighlightColor(palette)
    : remoteSelected
      ? remoteSelectionHighlightColor(palette)
      : null;
  const solidColor = selected
    ? palette.selectionHighlightStroke
    : remoteSelected
      ? palette.remoteSelectionHighlight
      : noteColor(palette, note.type);
  context.fillStyle = solidColor;
  const tint = selectionTint ?? note.tint ?? note.color;
  const noteColorStyle = tint
    ? { mode: selected || remoteSelected ? ("selected" as const) : ("tint" as const), color: tint }
    : undefined;
  const batched =
    note.type === 2
      ? this.noteBatch.addHold(
          this.appearance.skin,
          false,
          horizontal,
          vertical,
          horizontal,
          endVertical,
          noteWidth,
          true,
          alpha,
          noteColorStyle,
          undefined,
        )
      : this.noteBatch.addHead(
          this.appearance.skin,
          note.type,
          false,
          horizontal,
          vertical,
          noteWidth,
          rotation,
          shear,
          alpha,
          noteColorStyle,
        );
  let textured = batched;
  if (!textured) {
    if (note.type === 2) {
      textured =
        this.appearance.skin?.hold(
          context,
          horizontal,
          vertical,
          endVertical,
          noteWidth,
          false,
          true,
          noteColorStyle,
          undefined,
        ) ?? false;
    } else if (shear !== 0 || rotation !== 0) {
      context.save();
      context.translate(horizontal, vertical);
      context.rotate(rotation);
      context.transform(1, 0, shear, 1, 0, 0);
      textured =
        this.appearance.skin?.head(context, note.type, 0, 0, noteWidth, false, noteColorStyle) ??
        false;
      context.restore();
    } else {
      textured =
        this.appearance.skin?.head(
          context,
          note.type,
          horizontal,
          vertical,
          noteWidth,
          false,
          noteColorStyle,
        ) ?? false;
    }
  }
  if (!textured && !this.appearance.skin && note.type === 2) {
    textured = this.noteSolidBatch.addHold(
      horizontal,
      vertical,
      endVertical,
      noteWidth,
      height,
      alpha,
      solidColor,
    );
    if (!textured) {
      // The procedural shape is reserved for a timeline with no skin renderer.
      // A present skin must finish loading or fail visibly rather than silently
      // replacing its artwork with a different visual language.
      context.globalAlpha = alpha * 0.45;
      const top = Math.max(-10, endVertical);
      context.fillRect(
        horizontal - noteWidth / 2,
        top,
        noteWidth,
        Math.min(height + 20, vertical - top),
      );
      context.globalAlpha = alpha;
      context.fillRect(horizontal - noteWidth / 2, endVertical - 3, noteWidth, 6);
    }
  }
  if (!textured && !this.appearance.skin) {
    if (note.type !== 2) {
      textured = this.noteSolidBatch.addHead(
        horizontal,
        vertical,
        noteWidth,
        rotation,
        shear,
        alpha,
        solidColor,
      );
    }
    if (!textured && note.type !== 2 && (shear !== 0 || rotation !== 0)) {
      context.save();
      context.translate(horizontal, vertical);
      context.rotate(rotation);
      context.transform(1, 0, shear, 1, 0, 0);
      context.fillRect(-noteWidth / 2, -4, noteWidth, 8);
      context.restore();
    } else if (!textured && note.type !== 2) {
      context.fillRect(horizontal - noteWidth / 2, vertical - 4, noteWidth, 8);
    }
  }
  context.globalAlpha = 1;
}

/** Draw the note field for the current mode: grid, notes, ghosts, and multi-line chrome. */
export function draw(this: TimelineNoteDrawingReceiver, playBeat: number): void {
  const session = this.getSession();
  const palette = this.cache.palette() ?? readCanvasPalette();
  const { context, width, height } = prepareCanvas(this.notesCanvas);
  this.viewport.syncMultiLineChrome("notes", width);
  // The note backdrop is anchored to the live viewport, so repaint it with the
  // frame rather than keeping a translated bitmap.
  const backdrop = prepareCanvas(this.notesBackdrop);
  this.noteBatch.begin(width, height, this.appearance.skin);
  this.noteSolidBatch.begin(width, height);
  const multiNotes = session.notesMode !== "single";
  const multiplePanels = multiNotes && this.viewport.panelCount("notes") > 1;
  if (session.multiLineActive && this.viewport.panelCount("notes") > 1) {
    const panelWidth = this.viewport.panelWidth(width, "notes");
    const gap = this.viewport.panelGap(width, "notes");
    const offset = this.viewport.multiLineViewportOffset(width, "notes");
    context.fillStyle = palette.surface;
    for (let panel = 0; panel < this.viewport.panelCount("notes") - 1; panel++) {
      context.fillRect(panel * (panelWidth + gap) + panelWidth - offset, 0, gap, height);
    }
  }
  if (multiplePanels) {
    this.notesGridBatch.begin(width, height);
    this.drawMultiLineGrid(backdrop.context, width, height, playBeat, "notes", BACKGROUND_GRID);
    this.notesGridBatch.finish();
  } else {
    this.notesGridBatch.begin(width, height);
    this.grid(backdrop.context, width, height, playBeat, BACKGROUND_GRID, "notes");
    this.notesGridBatch.finish();
  }
  drawNoteLanes(this, backdrop.context, width, height);
  if (multiplePanels) {
    const panelWidth = this.viewport.panelWidth(width, "notes");
    const offset = this.viewport.multiLineViewportOffset(width, "notes");
    backdrop.context.save();
    backdrop.context.strokeStyle = palette.outline;
    backdrop.context.lineWidth = 2;
    const panelCount = this.viewport.panelCount("notes");
    const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, "notes");
    const firstSeparator = Math.max(0, firstPanel - 1);
    const lastSeparator = Math.min(panelCount - 2, lastPanel);
    for (let panel = firstSeparator; panel <= lastSeparator; panel++) {
      const separator = panel * this.viewport.panelStride(width, "notes") + panelWidth - offset;
      const lineIndex = session.targetLineIndices[panel];
      if (lineIndex !== undefined) {
        strokeVerticalGrid(backdrop.context, separator, height);
      }
    }
    backdrop.context.restore();
  }
  if (this.getSession().multiLineActive && this.getSession().multiLineMode === "notes") {
    this.drawMultiLineNotes(context, width, height);
  }
  this.drawCurveGhost(context);
  // Only the single-line pass paints here; the multi-line panels paint above.
  if (!multiNotes) {
    // Resolving the visible notes also refreshes this line's index, which the
    // prepared render data and paint-order query below read.
    const visibleEntries = this.visible();
    const { factor: noteFactor, project: verticalProjection } = noteProjectionFor(
      this,
      session.lineIndex,
      height,
    );
    const [bottomBeat, topBeat] = this.viewport.noteBeatRangeForLine(
      session.lineIndex,
      height,
      "notes",
    );
    const panelProjection = this.viewport.notePanelProjectionForLine(width, session.lineIndex);
    const noteSource =
      this.cache.noteIndex(session.lineIndex)?.notes ?? checkedNotes(session.notes);
    const cachedNoteData = this.cache.noteRenderDataSet(
      noteSource,
      this.viewport.tempo,
      noteFactor,
      this.viewport.gridCount,
    );
    const overlapRanks = this.cache.noteOverlapRanks(noteSource, this.appearance.overlapThreshold);
    const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
    const skewCurve = noteSkewCurve(session.line);
    const range = { start: 0, end: 0, invalid: false };
    const draggingSelection = ["move", "startTime", "endTime"].includes(
      this.gestures.drag?.kind ?? "",
    );
    const entries = draggingSelection
      ? new Map<number, { item: TimelineNote; index: number }>(
          visibleEntries.map((entry) => [entry.index, entry] as const),
        )
      : undefined;
    if (draggingSelection && entries) {
      for (const index of session.selection) {
        entries.set(index, { item: checkedNote(session.notes[index]), index });
      }
    }
    const paintEntries = entries
      ? [...entries.values()].sort(
          (left, right) => notePaintLayer(left.item.type) - notePaintLayer(right.item.type),
        )
      : this.cache.paintOrderedNotes(session.lineIndex, bottomBeat, topBeat);
    // Holds paint before the note heads so a Hold body never covers one.
    for (const entry of paintEntries) {
      const selected = session.selection.has(entry.index);
      const hovered = this.gestures.isNoteOverlapHovered(session.lineIndex, entry.index);
      const highlightSelected = overlapSelectionSuppressed ? hovered : selected;
      const remoteSelected =
        !highlightSelected &&
        !overlapSelectionSuppressed &&
        entry.item.id !== undefined &&
        this.remoteSelectedNoteIds.has(entry.item.id);
      const note = selected ? this.movedNote(entry.item) : entry.item;
      if (!isTimelineNoteRenderable(note)) {
        continue;
      }
      if (selected) {
        timelineRenderRangeInto(note.startTime, note.endTime, this.viewport.gridCount, range);
      }
      const prepared = selected ? undefined : cachedNoteData[entry.index];
      const startBeat = prepared?.start ?? range.start;
      const endBeat = prepared?.end ?? range.end;
      const startSeconds =
        prepared?.startSeconds ??
        this.cache.tempoSeconds(this.viewport.tempo, startBeat, noteFactor);
      const endSeconds =
        prepared?.endSeconds ?? this.cache.tempoSeconds(this.viewport.tempo, endBeat, noteFactor);
      const horizontal = panelProjection.horizontal(note.positionX);
      const vertical = verticalProjection(startSeconds);
      const endVertical = verticalProjection(endSeconds);
      const noteWidth =
        68 * this.viewport.renderNoteScale * Math.min(3, Math.max(0.2, note.size ?? 1));
      const renderedHorizontal = panelProjection.clamp(horizontal, noteWidth);
      if (renderedHorizontal == null) {
        continue;
      }
      drawNote.call(this, context, {
        palette,
        note,
        horizontal: renderedHorizontal,
        vertical,
        endVertical,
        noteWidth,
        height,
        selected: highlightSelected,
        remoteSelected,
        shear: skewCurve ? noteSkewShear(noteSkewAtHit(skewCurve, note)) : 0,
        rotation: noteOverlapRotation(overlapRanks.get(entry.index)),
      });
      if (note.type === 2 && (prepared?.invalid ?? range.invalid)) {
        drawEventOverlapFilter(
          context,
          {
            x: renderedHorizontal - noteWidth / 2,
            y: Math.min(vertical, endVertical),
            width: noteWidth,
            height: Math.max(2, Math.abs(endVertical - vertical)),
          },
          palette,
        );
      }
    }
  }
  if (this.gestures.pendingHold && this.gestures.cursor) {
    const lineIndex = this.gestures.pendingHold.lineIndex ?? this.getSession().lineIndex;
    // The second click may land before the first; the committed Hold always
    // orders its anchors, so the preview must swap them the same way or its
    // head and tail caps would flip on commit.
    const anchor = this.gestures.pendingHold.beat;
    const cursorBeat = this.viewport.snappedBeat(this.gestures.cursor.y);
    const startBeat = Math.min(anchor, cursorBeat);
    const endBeat = Math.max(anchor, cursorBeat);
    const projection = cachedNoteVerticalProjection(this, lineIndex, height);
    const panelProjection = this.viewport.notePanelProjectionForLine(width, lineIndex);
    const head = projection(startBeat);
    const tail = projection(endBeat);
    const pendingHorizontal = panelProjection.horizontal(this.gestures.pendingHold.positionX);
    context.globalAlpha = 0.65;
    const rendered = this.appearance.skin?.hold(
      context,
      pendingHorizontal,
      head,
      tail,
      68 * this.viewport.renderNoteScale,
    );
    if (!rendered && !this.appearance.skin) {
      context.fillRect(pendingHorizontal - 20, Math.min(head, tail), 40, Math.abs(tail - head));
    }
    context.globalAlpha = 1;
  } else if (this.gestures.cursor && this.gestures.tool) {
    const lineIndex =
      this.gestures.cursorLineIndex ??
      this.viewport.lineIndexAt(this.gestures.cursor.x, width, "notes");
    const positionX = this.viewport.notePositionAt(this.gestures.cursor.x, lineIndex);
    context.fillStyle = noteColor(palette, this.gestures.tool);
    context.globalAlpha = 0.53;
    const projection = cachedNoteVerticalProjection(this, lineIndex, height);
    const panelProjection = this.viewport.notePanelProjectionForLine(width, lineIndex);
    const vertical = projection(this.viewport.snappedBeat(this.gestures.cursor.y));
    context.fillRect(panelProjection.horizontal(positionX) - 24, vertical - 3, 48, 6);
    context.globalAlpha = 1;
  }
  context.globalAlpha = 1;
  if (typeof this.gestures.scaleAxis === "number" && Number.isFinite(this.gestures.scaleAxis)) {
    context.save();
    context.strokeStyle = palette.bottomValue;
    context.lineWidth = 2;
    context.setLineDash([8, 5]);
    const lines =
      session.multiLineActive && session.multiLineMode === "notes"
        ? session.targetLineIndices
        : [this.gestures.scaleAxisLine ?? session.lineIndex];
    for (const lineIndex of lines) {
      const horizontal = this.viewport.noteHorizontal(this.gestures.scaleAxis, lineIndex);
      context.beginPath();
      context.moveTo(horizontal, 0);
      context.lineTo(horizontal, height);
      context.stroke();
    }
    context.restore();
  }
  if (multiplePanels) {
    this.drawMultiLineGrid(context, width, height, playBeat, "notes", FOREGROUND_GRID);
    this.drawMultiLinePanelLabels(context, width, height, "notes");
  } else {
    this.grid(context, width, height, playBeat, FOREGROUND_GRID, "notes");
  }
  if (multiNotes) {
    this.drawMultiLineBeatLabels(context, width, height, "notes");
  }
  this.noteBatch.finish();
  this.noteSolidBatch.finish();
  if (!(session.multiLineActive && session.multiLineMode === "notes")) {
    this.drawEvents(playBeat);
  }
}

/** Paint only the moving playhead; note/event geometry remains untouched. */
export function drawPlayhead(this: TimelinePlayheadDrawingReceiver, playBeat: number): void {
  const session = this.getSession();
  const draw = (canvas: HTMLCanvasElement, area: "notes" | "events"): void => {
    const { context, width, height } = prepareCanvas(canvas);
    const multiplePanels =
      session.multiLineActive &&
      session.multiLineMode === area &&
      this.viewport.panelCount(area) > 1;
    const playheadBatch = area === "notes" ? this.notesPlayheadBatch : this.eventsPlayheadBatch;
    playheadBatch.begin(width, height);
    if (multiplePanels) {
      this.drawMultiLineGrid(context, width, height, playBeat, area, PLAYHEAD_GRID);
    } else {
      this.grid(context, width, height, playBeat, PLAYHEAD_GRID, area);
    }
    playheadBatch.finish();
  };
  draw(this.notesPlayhead, "notes");
  draw(this.eventsPlayhead, "events");
}

/** Draw every visible note into its multi-line panel. */
export function drawMultiLineNotes(
  this: TimelineNoteDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const session = this.getSession();
  const palette = this.cache.palette() ?? readCanvasPalette();
  const scratch = multiLineNoteScratchFor(this);
  const lineLabelCuller = scratch.lineLabelCuller;
  lineLabelCuller.clear();
  const range = scratch.range;
  const lineIndices = session.targetLineIndices;
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const multiplePanels = this.viewport.panelCount("notes") > 1;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, "notes");
  const startPanel = multiplePanels ? firstPanel : 0;
  const endPanel = multiplePanels
    ? Math.min(lastPanel, lineIndices.length - 1)
    : lineIndices.length - 1;
  context.save();
  for (let panel = startPanel; panel <= endPanel; panel++) {
    const lineIndex = lineIndices[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const lineOpacity = multiLineLineOpacity(
      lineIndex,
      session.lineIndex,
      this.appearance.multiLineNonCurrentOpacity,
    );
    const line = session.chart.judgeLineList?.[lineIndex];
    const skewCurve = noteSkewCurve(line);
    const [bottomBeat, topBeat] = this.viewport.noteBeatRangeForLine(lineIndex, height, "notes");
    this.cache.refreshNotes(lineIndex, line?.notes ?? []);
    const noteIndex = this.cache.noteIndex(lineIndex);
    if (!noteIndex) {
      continue;
    }
    const overlapRanks = this.cache.noteOverlapRanks(
      noteIndex.notes,
      this.appearance.overlapThreshold,
    );
    const { factor: noteFactor, project: verticalProjection } = noteProjectionFor(
      this,
      lineIndex,
      height,
    );
    const cachedNoteData = this.cache.noteRenderDataSet(
      noteIndex.notes,
      this.viewport.tempo,
      noteFactor,
      this.viewport.gridCount,
    );
    const panelProjection = this.viewport.notePanelProjectionForLine(width, lineIndex);
    const selectedSet = selectedNoteIndices(session, lineIndex);
    const draggingLine = this.gestures.drag?.lineIndex === lineIndex && !this.gestures.preview;
    // Paint layer first so Holds stay beneath note heads; author order keeps
    // the original index order inside one layer.
    const entries = this.cache.paintOrderedNotes(lineIndex, bottomBeat, topBeat);
    for (const { index, item: sourceNote } of entries) {
      const selected = selectedSet.has(index);
      const moved = selected && draggingLine;
      const note = moved ? this.movedNote(sourceNote) : sourceNote;
      if (moved) {
        timelineRenderRangeInto(note.startTime, note.endTime, this.viewport.gridCount, range);
      }
      const prepared = moved ? undefined : cachedNoteData[index];
      const beat = prepared?.start ?? range.start;
      const endBeat = prepared?.end ?? range.end;
      if (Math.max(beat, endBeat) < bottomBeat || Math.min(beat, endBeat) > topBeat) {
        continue;
      }
      const horizontal = panelProjection.horizontal(note.positionX);
      const noteWidth = this.viewport.noteWidth(note);
      const rendered = panelProjection.clamp(horizontal, noteWidth);
      if (rendered == null) {
        continue;
      }
      const startSeconds =
        prepared?.startSeconds ?? this.cache.tempoSeconds(this.viewport.tempo, beat, noteFactor);
      const endSeconds =
        prepared?.endSeconds ?? this.cache.tempoSeconds(this.viewport.tempo, endBeat, noteFactor);
      const vertical = verticalProjection(startSeconds);
      const endVertical = verticalProjection(endSeconds);
      const hovered = this.gestures.isNoteOverlapHovered(lineIndex, index);
      const highlightSelected = overlapSelectionSuppressed ? hovered : selected;
      const remoteSelected =
        !highlightSelected &&
        !overlapSelectionSuppressed &&
        note.id !== undefined &&
        this.remoteSelectedNoteIds.has(note.id);
      drawNote.call(this, context, {
        palette,
        note,
        horizontal: rendered,
        vertical,
        endVertical,
        noteWidth,
        height,
        selected: highlightSelected,
        remoteSelected,
        opacityMultiplier: lineOpacity,
        shear: skewCurve ? noteSkewShear(noteSkewAtHit(skewCurve, note)) : 0,
        rotation: noteOverlapRotation(overlapRanks.get(index)),
      });
      if (note.type === 2 && (prepared?.invalid ?? range.invalid)) {
        drawEventOverlapFilter(
          context,
          {
            x: rendered - noteWidth / 2,
            y: Math.min(vertical, endVertical),
            width: noteWidth,
            height: Math.max(2, Math.abs(endVertical - vertical)),
          },
          palette,
        );
      }
      if (
        session.notesMode === "multi_merged" &&
        this.appearance.multiLineNoteLineNumbers &&
        session.targetLineIndices.length > 1 &&
        lineLabelCuller.tryPlace(
          { x: rendered, y: vertical },
          { horizontalGap: 14, verticalGap: 18, force: selected },
        )
      ) {
        context.fillStyle = palette.bottomValue;
        context.font = canvasFont("body");
        context.textAlign = "center";
        context.fillText(String(lineIndex), rendered, vertical + 18);
        context.textAlign = "left";
      }
    }
  }
  context.globalAlpha = 1;
  context.restore();
}
