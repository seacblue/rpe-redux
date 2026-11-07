/**
 * Draws judge lines and their notes into the preview canvas, including hold
 * bodies and line textures. Scene state is read through the preview frame; this
 * module owns painting and pass selection, not chart evaluation.
 */
import { DEFAULT_LINE_HEIGHT, DEFAULT_LINE_WIDTH, previewNoteWidth } from "../scene/constants.ts";
import { noteSkewShear } from "../../../canvas/noteGeometry.ts";
import { textureInViewport } from "./textureVisibility.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import {
  noteColor,
  readCanvasPalette,
  selectionHighlightColor,
  type CanvasPalette,
} from "../../../canvas/palette.ts";
import { noteIsAbove } from "../../../../../../core/global/chart/chart.ts";
import { drawLine } from "./previewGuides.ts";
import type { JudgeLine, JudgeLineNote } from "../../../../../../core/global/chart/chart.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import type {
  NoteEntry,
  NoteState,
  SampledLineState,
} from "../../../../../../core/global/chart/runtime/scene.ts";
import type {
  PreviewFrame,
  PreviewHitArea,
  PreviewLineFrame,
  PreviewNoteSelection,
  PreviewTextureSurface,
} from "../scene/previewTypes.ts";
import type { NoteBatch } from "../../../canvas/noteBatch.ts";

/** Screen-space quad of a judge line, including its texture size and rotated corners. */
function lineGeometry(
  surface: PreviewLineSurface,
  line: JudgeLine,
  state: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  centerX: number,
  centerY: number,
  scale: number,
  scaleX = scale,
  scaleY = scale,
): { width: number; height: number; corners: readonly { x: number; y: number }[] } {
  const defaultLine = !line.Texture || line.Texture === "line.png";
  const descriptor = !defaultLine ? surface.images?.describe?.(line.Texture ?? "") : null;
  const baseWidth = defaultLine
    ? DEFAULT_LINE_WIDTH * scale
    : (descriptor?.naturalWidth ?? descriptor?.width ?? 0) * scale;
  const baseHeight = defaultLine
    ? DEFAULT_LINE_HEIGHT * surface.lineScale * scale
    : (descriptor?.naturalHeight ?? descriptor?.height ?? 0) * scale;
  const anchor = defaultLine ? [0.5, 0.5] : (line.anchor ?? [0.5, 0.5]);
  const left = -baseWidth * anchor[0];
  const top = -baseHeight * (1 - anchor[1]);
  const localCorners = [
    { x: left, y: top },
    { x: left + baseWidth, y: top },
    { x: left + baseWidth, y: top + baseHeight },
    { x: left, y: top + baseHeight },
  ];
  const angle = (state.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    width: baseWidth,
    height: baseHeight,
    corners: localCorners.map((point) => {
      const scaledX = point.x * state.scaleX;
      const scaledY = point.y * state.scaleY;
      return {
        x: centerX + state.x * scaleX + scaledX * cosine - scaledY * sine,
        y: centerY - state.y * scaleY + scaledX * sine + scaledY * cosine,
      };
    }),
  };
}

/** One draw step of a frame: a judge line, or the notes and holds above them. */
export type RenderPass =
  { kind: "line"; index: number; depth: number } | { kind: "hold" | "note"; depth: number };

/** Depth-sorted draw order: judge lines by `zOrder`, notes and holds on top. */
export function linePasses(lines: readonly JudgeLine[], order: readonly number[]): RenderPass[] {
  const passes: RenderPass[] = order.map((index) => ({
    kind: "line",
    index,
    depth: lines[index].zOrder ?? 0,
  }));
  passes.push({ kind: "hold", depth: 999 }, { kind: "note", depth: 1000 });
  return passes.sort((left, right) => left.depth - right.depth);
}

/**
 * Resolve the authored note colour used by preview painting.
 *
 * Selection is deliberately absent from this contract: selection changes
 * editor state, but it must not recolour a skin texture and expose its alpha
 * edge as a border.
 */
export function previewNoteTint(
  note: Pick<JudgeLineNote, "color"> & { tint?: unknown },
): number[] | undefined {
  return Array.isArray(note.tint) ? note.tint : Array.isArray(note.color) ? note.color : undefined;
}

/** Return whether one preview note belongs to the editor's current selection. */
export function isPreviewNoteSelected(
  selectedNotes: PreviewNoteSelection,
  lineIndex: number,
  noteIndex: number,
): boolean {
  return selectedNotes.get(lineIndex)?.has(noteIndex) === true;
}

/** State read by line/note drawing and hit areas written during the frame. */
export interface PreviewLineSurface extends PreviewTextureSurface {
  noteBatch: NoteBatch;
  passes: RenderPass[];
  noteOpacity: number;
  selectedLines: readonly number[];
  selectedLineColor: readonly number[];
  selectedNotes: PreviewNoteSelection;
  highlight?: boolean;
  /** Isolate one judge line and its notes; see `Preview.soloLine`. */
  soloLine?: number | null;
  /** Draw this line in `focusLineColor`; the curve preview uses it for the edited line. */
  focusLine?: number | null;
  focusLineColor?: readonly number[];
  /** Workspace sampler focus: only this line takes the selected-line colour. */
  samplingFocus?: { lineIndex: number; color: readonly number[] } | null;
  /** Workspace sampler opacity override for one judge line. */
  samplingAlpha?: { lineIndex: number; alpha: number } | null;
  simultaneous: Set<unknown> | null;
  noteSize: number;
  lineFrames: PreviewLineFrame[];
  noteHitAreas: PreviewHitArea[];
  collectGeometry: boolean;
}

/** Only rendered judge lines may contribute geometry to preview picking. */
export function isPreviewLineInteractable(
  line: Pick<JudgeLine, "attachUI"> | undefined,
  state: Pick<SampledLineState, "alpha" | "scaleX" | "scaleY">,
): boolean {
  return (
    line !== undefined &&
    !line.attachUI &&
    state.alpha > 0 &&
    state.scaleX !== 0 &&
    state.scaleY !== 0
  );
}

/** Alpha shared by a Hold body and its unskinned head in the canvas fallback. */
export function holdFallbackAlpha(positionAlpha: number, noteOpacity: number): number {
  return clamp01(positionAlpha) * noteOpacity;
}

interface PreviewNoteScreenGeometry {
  horizontal: number;
  headX: number;
  headY: number;
  tailX: number;
  tailY: number;
}

/** Resolve the screen coordinates shared by note rendering, culling, and picking. */
function previewNoteScreenGeometry(
  position: NoteState,
  state: Pick<SampledLineState, "x" | "y">,
  centerX: number,
  centerY: number,
  scaleX: number,
  scaleY: number,
  cosine: number,
  sine: number,
): PreviewNoteScreenGeometry {
  const horizontal = position.x * scaleX;
  const worldX = state.x + position.x * cosine + position.y * sine;
  const worldY = -state.y + position.x * sine - position.y * cosine;
  const headX = centerX + worldX * scaleX;
  const headY = centerY + worldY * scaleY;
  const tail = Number.isFinite(position.tail) ? position.tail : position.y;
  const tailWorldX = state.x + position.x * cosine + tail * sine;
  const tailWorldY = -state.y + position.x * sine - tail * cosine;
  return {
    horizontal,
    headX,
    headY,
    tailX: centerX + tailWorldX * scaleX,
    tailY: centerY + tailWorldY * scaleY,
  };
}

/** Return whether a note segment can contribute pixels inside the preview viewport. */
function previewNoteInViewport(
  geometry: PreviewNoteScreenGeometry,
  noteWidth: number,
  viewport: PreviewFrame["viewport"],
): boolean {
  const screenPadding = Math.max(32, noteWidth * 2);
  const minScreenX = Math.min(geometry.headX, geometry.tailX);
  const maxScreenX = Math.max(geometry.headX, geometry.tailX);
  const minScreenY = Math.min(geometry.headY, geometry.tailY);
  const maxScreenY = Math.max(geometry.headY, geometry.tailY);
  return !(
    maxScreenX < viewport.left - screenPadding ||
    minScreenX > viewport.left + viewport.width + screenPadding ||
    maxScreenY < viewport.top - screenPadding ||
    minScreenY > viewport.top + viewport.height + screenPadding
  );
}

/** Return whether one preview note should use the gameplay highlight skin. */
export function shouldHighlightPreviewNote(surface: PreviewLineSurface, entry: NoteEntry): boolean {
  return surface.highlight !== false && (surface.simultaneous?.has(entry.note) ?? false);
}

/** Append the hit area using the same skin metrics as the visible note. */
function appendPreviewNoteHitArea(
  surface: PreviewLineSurface,
  lineIndex: number,
  entry: NoteEntry,
  geometry: PreviewNoteScreenGeometry,
  noteWidth: number,
  highlight: boolean,
  rotation: number,
): void {
  const isHold = entry.note.type === 2;
  const holdHeadTexture = isHold ? surface.skin?.holdHeadTexture(highlight) : null;
  const texture = isHold ? holdHeadTexture : surface.skin?.noteTexture(entry.note.type, highlight);
  const noteHeight = texture
    ? (noteWidth * texture.useful.height) / texture.useful.width
    : Math.max(8, noteWidth * 0.25);
  const holdEndTexture = isHold ? surface.skin?.holdEndTexture() : null;
  const holdHeadLength = holdHeadTexture
    ? (noteWidth * holdHeadTexture.useful.height) / holdHeadTexture.useful.width
    : 0;
  const holdTailLength = holdEndTexture
    ? (noteWidth * holdEndTexture.useful.height) / holdEndTexture.useful.width
    : 0;
  surface.noteHitAreas.push({
    noteIndex: entry.noteIndex,
    lineIndex,
    kind: isHold ? "hold" : "note",
    x1: geometry.headX,
    y1: geometry.headY,
    x2: geometry.tailX,
    y2: geometry.tailY,
    radius: Math.max(12, noteWidth * 0.65),
    width: noteWidth,
    height: isHold ? undefined : noteHeight,
    headLength: isHold ? holdHeadLength : undefined,
    tailLength: isHold ? holdTailLength : undefined,
    rotation,
  });
}

/** Submit one visible note to the batch, falling back to Canvas when needed. */
function drawPreviewNoteEntry(
  surface: PreviewLineSurface,
  context: CanvasRenderingContext2D,
  palette: CanvasPalette,
  lineIndex: number,
  selectedLine: number,
  entry: NoteEntry,
  position: NoteState,
  geometry: PreviewNoteScreenGeometry,
  noteWidth: number,
  scaleY: number,
  rotation: number,
  lineRotation: number,
  selected: boolean,
  highlight: boolean,
): boolean {
  const isHold = entry.note.type === 2;
  if (surface.collectGeometry) {
    appendPreviewNoteHitArea(
      surface,
      lineIndex,
      entry,
      geometry,
      noteWidth,
      highlight,
      lineRotation,
    );
  }
  const noteOpacity = lineIndex === selectedLine ? 1 : clamp01(surface.noteOpacity);
  const tint = selected ? selectionHighlightColor(palette) : previewNoteTint(entry.note);
  const noteColorStyle = tint
    ? { mode: selected ? ("selected" as const) : ("tint" as const), color: tint }
    : undefined;
  const noteAlpha = holdFallbackAlpha(position.alpha, noteOpacity);
  const skewShear = noteSkewShear(position.skew);
  const batchAdded = isHold
    ? surface.noteBatch.addHold(
        surface.skin ?? null,
        highlight,
        geometry.headX,
        geometry.headY,
        geometry.tailX,
        geometry.tailY,
        noteWidth,
        position.showHead,
        noteAlpha,
        noteColorStyle,
        rotation + (noteIsAbove(entry.note) ? Math.PI : 0),
      )
    : surface.noteBatch.addHead(
        surface.skin ?? null,
        entry.note.type,
        highlight,
        geometry.headX,
        geometry.headY,
        noteWidth,
        rotation,
        skewShear,
        noteAlpha,
        noteColorStyle,
      );
  if (batchAdded) {
    return false;
  }
  paintPreviewNoteFallback(
    surface,
    context,
    palette,
    entry.note.type,
    position,
    noteWidth,
    geometry.horizontal,
    scaleY,
    selected,
    highlight,
    noteAlpha,
    tint,
    skewShear,
  );
  return true;
}

/**
 * Paint one preview note into the 2D fallback.
 *
 * The fallback mirrors the batched skin geometry so a missing WebGL texture
 * does not change note placement, tint, or hold orientation.
 */
function paintPreviewNoteFallback(
  surface: PreviewLineSurface,
  context: CanvasRenderingContext2D,
  palette: CanvasPalette,
  noteType: number,
  position: NoteState,
  noteWidth: number,
  horizontal: number,
  scaleY: number,
  selected: boolean,
  highlight: boolean,
  alpha: number,
  tint: number[] | undefined,
  skewShear: number,
): void {
  context.save();
  context.globalAlpha = alpha;
  const noteColorStyle = tint
    ? { mode: selected ? ("selected" as const) : ("tint" as const), color: tint }
    : undefined;
  context.fillStyle = selected
    ? palette.selectionHighlightStroke
    : Array.isArray(tint)
      ? `rgb(${tint.join(",")})`
      : noteColor(palette, noteType);
  let drawnHold = false;
  if (noteType === 2) {
    drawnHold =
      surface.skin?.hold(
        context,
        horizontal,
        -position.y * scaleY,
        -position.tail * scaleY,
        noteWidth,
        highlight,
        position.showHead,
        noteColorStyle,
        Math.atan2(0, -position.tail + position.y),
      ) ?? false;
  }
  if (noteType === 2 && !drawnHold) {
    context.fillRect(
      horizontal - noteWidth / 2,
      -position.tail * scaleY,
      noteWidth,
      (position.tail - position.y) * scaleY,
    );
  }
  if (position.showHead && !drawnHold) {
    context.globalAlpha = alpha;
    context.translate(horizontal, -position.y * scaleY);
    context.transform(1, 0, skewShear, 1, 0, 0);
    if (!surface.skin?.head(context, noteType, 0, 0, noteWidth, highlight, noteColorStyle)) {
      context.fillRect(-noteWidth / 2, -2, noteWidth, 4);
    }
  }
  context.restore();
}

/** Per-frame draw counts and elapsed time split between lines and notes. */
export interface PreviewLineDrawStats {
  lines: number;
  notes: number;
  holds: number;
  batchFallbacks: number;
  lineMs: number;
  noteMs: number;
}

/** Draws judge lines and notes in render order while collecting hit areas. */
export function drawLinePasses(
  surface: PreviewLineSurface,
  frame: PreviewFrame,
): PreviewLineDrawStats {
  const stats: PreviewLineDrawStats = {
    lines: 0,
    notes: 0,
    holds: 0,
    batchFallbacks: 0,
    lineMs: 0,
    noteMs: 0,
  };
  const palette = readCanvasPalette();
  const {
    context,
    chart,
    states,
    order,
    visibleNotes,
    visibleHolds,
    seconds,
    selectedLine,
    scale,
    scaleX,
    scaleY,
    viewport,
  } = frame;
  const { centerX, centerY } = frame;
  const lines = frame.scene.lines;
  const noteState: NoteState = {
    x: 0,
    y: 0,
    tail: 0,
    size: 0,
    alpha: 0,
    skew: 0,
    showHead: false,
  };
  surface.noteHitAreas.length = 0;
  surface.lineFrames.length = 0;
  // A sampled line is lifted above the other judge lines so its focus colour
  // and opacity preview stay visible when lines overlap. Notes and holds keep
  // their own later passes.
  const samplingLine = surface.samplingFocus?.lineIndex;
  const linePasses =
    samplingLine == null
      ? null
      : surface.passes.filter(
          (pass): pass is { kind: "line"; index: number; depth: number } => pass.kind === "line",
        );
  const passes =
    samplingLine == null || linePasses == null
      ? surface.passes
      : [
          ...linePasses.filter((pass) => pass.index !== samplingLine),
          ...linePasses.filter((pass) => pass.index === samplingLine),
          ...surface.passes.filter((pass) => pass.kind !== "line"),
        ];
  for (const pass of passes) {
    const singleLinePass = pass.kind === "line";
    const passLength = singleLinePass ? 1 : order.length;
    const passStarted = performance.now();
    for (let passIndex = 0; passIndex < passLength; passIndex++) {
      const index = singleLinePass ? pass.index : order[passIndex];
      if (surface.soloLine != null && index !== surface.soloLine) {
        continue;
      }
      const state = states[index];
      if (!state) {
        // A line outside the sampled range has no state to draw.
        continue;
      }
      const samplingAlpha =
        surface.samplingAlpha?.lineIndex === index ? surface.samplingAlpha.alpha : null;
      const paintedState = samplingAlpha === null ? state : { ...state, alpha: samplingAlpha };
      if (
        pass.kind === "line" &&
        !isPreviewLineInteractable(chart.judgeLineList?.[index], paintedState)
      ) {
        continue;
      }
      const runtime = lines[index];
      if (!runtime) {
        continue;
      }
      if (noiseLineSettings(runtime.line)) {
        continue;
      }
      if (
        pass.kind !== "line" &&
        ((pass.kind === "hold" ? visibleHolds[index] : visibleNotes[index])?.length ?? 0) === 0
      ) {
        continue;
      }
      if (pass.kind === "line" && !runtime.line.extended?.textEvents?.length) {
        const texture =
          runtime.line.Texture && runtime.line.Texture !== "line.png"
            ? (surface.images?.describe?.(runtime.line.Texture) ??
              surface.images?.images?.get(runtime.line.Texture))
            : {
                naturalWidth: DEFAULT_LINE_WIDTH,
                naturalHeight: DEFAULT_LINE_HEIGHT * surface.lineScale,
              };
        if (
          !texture ||
          (texture.naturalWidth &&
            !textureInViewport(
              texture,
              runtime.line,
              state,
              centerX,
              centerY,
              scale,
              scaleX,
              scaleY,
              viewport,
            ))
        ) {
          continue;
        }
      }
      context.save();
      context.translate(centerX + state.x * scaleX, centerY - state.y * scaleY);
      const rotation = (state.rotation * Math.PI) / 180;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      context.rotate(rotation);
      if (pass.kind === "line") {
        stats.lines += 1;
        if (surface.collectGeometry) {
          const geometry = lineGeometry(
            surface,
            runtime.line,
            state,
            centerX,
            centerY,
            scale,
            scaleX,
            scaleY,
          );
          surface.lineFrames.push({
            lineIndex: index,
            x: centerX + state.x * scaleX,
            y: centerY - state.y * scaleY,
            rotation: state.rotation,
            scaleX: state.scaleX,
            scaleY: state.scaleY,
            ...geometry,
            texture: runtime.line.Texture ?? "line.png",
          });
        }
        const focused = surface.focusLine != null && index === surface.focusLine;
        const samplingFocus =
          surface.samplingFocus?.lineIndex === index ? surface.samplingFocus : null;
        // Sampling owns the only selected-line tint: another line already in a
        // multi-line selection keeps its normal paint while the sampler runs.
        const selected =
          surface.samplingFocus == null &&
          surface.selectedLineColor.length >= 3 &&
          surface.selectedLines.includes(index);
        drawLine(
          surface,
          context,
          runtime.line,
          focused
            ? { ...paintedState, color: [...(surface.focusLineColor ?? [255, 64, 64])] }
            : samplingFocus
              ? { ...paintedState, color: [...samplingFocus.color] }
              : selected
                ? { ...paintedState, color: [...surface.selectedLineColor] }
                : paintedState,
          scale,
        );
      } else {
        const isHoldPass = pass.kind === "hold";
        const entries = isHoldPass ? visibleHolds[index] : visibleNotes[index];
        for (const entry of entries ?? []) {
          const note = entry.note;
          const isHold = note.type === 2;
          if (isHold !== isHoldPass) {
            continue;
          }
          // Every entry appears in one pass, so the shared object is consumed
          // immediately and can be reused for the next note.
          const position = runtime.noteState(entry, state, seconds, noteState);
          if (position.alpha <= 0 || position.size === 0) {
            continue;
          }
          if (note.type === 2) {
            stats.holds += 1;
          } else {
            stats.notes += 1;
          }
          const noteWidth = previewNoteWidth(surface.noteSize) * scaleX * position.size;
          const geometry = previewNoteScreenGeometry(
            position,
            state,
            centerX,
            centerY,
            scaleX,
            scaleY,
            cosine,
            sine,
          );
          // Runtime visibility is a world-space broad phase. The screen-space
          // helper prevents dense charts from uploading notes that the preview
          // clip can never show.
          if (!previewNoteInViewport(geometry, noteWidth, viewport)) {
            continue;
          }
          const selected =
            entry.noteIndex !== undefined &&
            isPreviewNoteSelected(surface.selectedNotes, index, entry.noteIndex);
          const highlight = shouldHighlightPreviewNote(surface, entry);
          if (
            drawPreviewNoteEntry(
              surface,
              context,
              palette,
              index,
              selectedLine,
              entry,
              position,
              geometry,
              noteWidth,
              scaleY,
              rotation,
              state.rotation,
              selected,
              highlight,
            )
          ) {
            stats.batchFallbacks += 1;
          }
        }
      }
      context.restore();
      const passMs = performance.now() - passStarted;
      if (singleLinePass) {
        stats.lineMs += passMs;
      } else {
        stats.noteMs += passMs;
      }
    }
  }
  return stats;
}
