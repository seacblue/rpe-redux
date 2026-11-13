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
import { preparedLineCache, type PreparedPreviewLine } from "./preparedLineCache.ts";
import { passesForSampling } from "./previewPassOrder.ts";
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
  PreviewOverlapHighlight,
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

/**
 * Depth-sorted draw order: judge lines by `zOrder`, then Holds, then note heads.
 *
 * The Hold pass runs before the note pass so the Canvas fallback paints Holds
 * beneath Tap/Drag/Flick heads; the GPU batch enforces the same order through
 * `notePaintLayer`.
 */
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
  /** Transient highlight driven by the overlap picker's hovered row. */
  overlapHighlight: PreviewOverlapHighlight | null;
  /** True while the overlap picker is open; ordinary selection paint is hidden. */
  overlapMenuOpen: boolean;
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
  target: PreviewNoteScreenGeometry,
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
  target.horizontal = horizontal;
  target.headX = headX;
  target.headY = headY;
  target.tailX = centerX + tailWorldX * scaleX;
  target.tailY = centerY + tailWorldY * scaleY;
  return target;
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
  showHead: boolean,
  holdCapScale: number,
): void {
  const isHold = entry.note.type === 2;
  const holdHeadTexture = isHold ? surface.skin?.holdHeadTexture(highlight) : null;
  const texture = isHold ? holdHeadTexture : surface.skin?.noteTexture(entry.note.type, highlight);
  const noteHeight = texture
    ? (noteWidth * texture.useful.height) / texture.useful.width
    : Math.max(8, noteWidth * 0.25);
  const holdEndTexture = isHold ? surface.skin?.holdEndTexture(highlight) : null;
  const holdHeadLength = holdHeadTexture
    ? (noteWidth * holdHeadTexture.useful.height * holdCapScale) / holdHeadTexture.useful.width
    : 0;
  const holdTailLength = holdEndTexture
    ? (noteWidth * holdEndTexture.useful.height * holdCapScale) / holdEndTexture.useful.width
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
    showHead: isHold ? showHead : undefined,
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
  holdCapScale: number,
  rotation: number,
  lineRotation: number,
  lineCenterX: number,
  lineCenterY: number,
  lineRotationRadians: number,
  selected: boolean,
  highlight: boolean,
): boolean {
  const isHold = entry.note.type === 2;
  const holdRotation = rotation + (noteIsAbove(entry.note) ? Math.PI : 0);
  if (surface.collectGeometry) {
    appendPreviewNoteHitArea(
      surface,
      lineIndex,
      entry,
      geometry,
      noteWidth,
      highlight,
      lineRotation,
      position.showHead,
      holdCapScale,
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
        holdRotation,
        holdCapScale,
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
  // A batch-active note pass is in screen space; restore the line transform
  // only for this fallback note so Canvas keeps the legacy geometry contract.
  const restoreBatchTransform = surface.noteBatch.isActive();
  if (restoreBatchTransform) {
    context.save();
    context.translate(lineCenterX, lineCenterY);
    context.rotate(lineRotationRadians);
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
    holdRotation,
    holdCapScale,
  );
  if (restoreBatchTransform) {
    context.restore();
  }
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
  holdRotation: number,
  holdCapScale: number,
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
    const axis = position.tail - position.y;
    const holdAxisRotation = Math.abs(axis) < 1e-6 ? holdRotation : Math.atan2(0, -axis);
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
        holdAxisRotation,
        holdCapScale,
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
  fallbackReasons: Record<string, number>;
  lineMs: number;
  noteMs: number;
}

/** Explain why a visible note had to use the Canvas path. */
function previewFallbackReason(surface: PreviewLineSurface): string {
  if (surface.noteBatch.isContextLost?.() === true) {
    return "context_lost";
  }
  if (!surface.skin) {
    return "missing_skin";
  }
  return surface.noteBatch.isActive() ? "texture_unavailable" : "batch_inactive";
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
    fallbackReasons: {},
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
  const preparedCache = preparedLineCache(surface);
  const preparedLines = preparedCache.entries;
  const preparedGeneration = preparedCache.generation;
  const batchActive = surface.noteBatch.isActive();
  /** Prepare one line's shared transform once for every draw pass in this frame. */
  const prepareLine = (index: number): PreparedPreviewLine | null => {
    const state = states[index];
    const runtime = lines[index];
    if (!state || !runtime) {
      return null;
    }
    const cached = preparedLines[index];
    if (cached?.frame === preparedGeneration) {
      return cached;
    }
    const rotation = (state.rotation * Math.PI) / 180;
    const prepared = cached ?? {
      frame: 0,
      state,
      runtime,
      selectedNotes: undefined,
      centerX: 0,
      centerY: 0,
      rotation: 0,
      cosine: 1,
      sine: 0,
      holdCapScale: 1,
      lineScaleX: 1,
      lineScaleY: 1,
      isNoiseLine: false,
    };
    prepared.frame = preparedGeneration;
    prepared.state = state;
    prepared.runtime = runtime;
    prepared.selectedNotes = surface.selectedNotes.get(index);
    prepared.centerX = centerX + state.x * scaleX;
    prepared.centerY = centerY - state.y * scaleY;
    prepared.rotation = rotation;
    prepared.cosine = Math.cos(rotation);
    prepared.sine = Math.sin(rotation);
    // The preview can scale X and Y independently. A Hold cap runs along the
    // line's local Y axis, so scale its length by that axis instead of the
    // note's horizontal width scale; otherwise caps shorter than the note
    // spacing leave gaps on static lines.
    const localXScale = Math.hypot(prepared.cosine * scaleX, prepared.sine * scaleY);
    const localYScale = Math.hypot(prepared.sine * scaleX, prepared.cosine * scaleY);
    prepared.holdCapScale = localXScale > 0 ? localYScale / localXScale : 1;
    prepared.lineScaleX = state.scaleX;
    prepared.lineScaleY = state.scaleY;
    prepared.isNoiseLine = noiseLineSettings(runtime.line) !== null;
    preparedLines[index] = prepared;
    return prepared;
  };
  const noteState: NoteState = {
    x: 0,
    y: 0,
    tail: 0,
    size: 0,
    alpha: 0,
    skew: 0,
    showHead: false,
  };
  const noteGeometry: PreviewNoteScreenGeometry = {
    horizontal: 0,
    headX: 0,
    headY: 0,
    tailX: 0,
    tailY: 0,
  };
  surface.noteHitAreas.length = 0;
  surface.lineFrames.length = 0;
  // A sampled line is lifted above the other judge lines so its focus colour
  // and opacity preview stay visible when lines overlap. Notes and holds keep
  // their own later passes.
  const passes = passesForSampling(surface.passes, surface.samplingFocus?.lineIndex);
  for (const pass of passes) {
    const singleLinePass = pass.kind === "line";
    const passLength = singleLinePass ? 1 : order.length;
    const passStarted = performance.now();
    for (let passIndex = 0; passIndex < passLength; passIndex++) {
      const index = singleLinePass ? pass.index : order[passIndex];
      if (surface.soloLine != null && index !== surface.soloLine) {
        continue;
      }
      const prepared = prepareLine(index);
      if (!prepared) {
        // A line outside the sampled range has no state to draw.
        continue;
      }
      const { state, runtime } = prepared;
      const samplingAlpha =
        surface.samplingAlpha?.lineIndex === index ? surface.samplingAlpha.alpha : null;
      const paintedState = samplingAlpha === null ? state : { ...state, alpha: samplingAlpha };
      if (
        pass.kind === "line" &&
        !isPreviewLineInteractable(chart.judgeLineList?.[index], paintedState)
      ) {
        continue;
      }
      if (prepared.isNoiseLine) {
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
      const lineCenterX = prepared.centerX;
      const lineCenterY = prepared.centerY;
      // NoteBatch receives screen-space coordinates. Canvas needs the line
      // transform only when it will paint the line or the fallback notes.
      const usesCanvasLineTransform = singleLinePass || !batchActive;
      if (usesCanvasLineTransform) {
        context.save();
        context.translate(lineCenterX, lineCenterY);
      }
      const { rotation, cosine, sine } = prepared;
      if (usesCanvasLineTransform) {
        context.rotate(rotation);
      }
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
            x: prepared.centerX,
            y: prepared.centerY,
            rotation: state.rotation,
            scaleX: prepared.lineScaleX,
            scaleY: prepared.lineScaleY,
            ...geometry,
            texture: runtime.line.Texture ?? "line.png",
          });
        }
        const focused = surface.focusLine != null && index === surface.focusLine;
        const samplingFocus =
          surface.samplingFocus?.lineIndex === index ? surface.samplingFocus : null;
        // Sampling owns the only selected-line tint: another line already in a
        // multi-line selection keeps its normal paint while the sampler runs.
        const hoveredLine = surface.overlapHighlight?.line;
        const selected =
          surface.samplingFocus == null &&
          surface.selectedLineColor.length >= 3 &&
          (surface.overlapMenuOpen ? hoveredLine === index : surface.selectedLines.includes(index));
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
          // Every entry appears in one pass, so the shared object is consumed
          // immediately and can be reused for the next note.
          const position = runtime.noteState(entry, state, seconds, noteState);
          if (position.alpha <= 0 || position.size === 0) {
            continue;
          }
          if (isHoldPass) {
            stats.holds += 1;
          } else {
            stats.notes += 1;
          }
          const noteWidth = previewNoteWidth(surface.noteSize) * scaleX * position.size;
          const geometry = previewNoteScreenGeometry(
            noteGeometry,
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
          const hoveredNote = surface.overlapHighlight?.note;
          const selected = surface.overlapMenuOpen
            ? hoveredNote !== undefined &&
              hoveredNote.lineIndex === index &&
              hoveredNote.noteIndex === entry.noteIndex
            : entry.noteIndex !== undefined &&
              prepared.selectedNotes?.has(entry.noteIndex) === true;
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
              prepared.holdCapScale,
              rotation,
              state.rotation,
              lineCenterX,
              lineCenterY,
              rotation,
              selected,
              highlight,
            )
          ) {
            stats.batchFallbacks += 1;
            const reason = previewFallbackReason(surface);
            stats.fallbackReasons[reason] = (stats.fallbackReasons[reason] ?? 0) + 1;
          }
        }
      }
      if (usesCanvasLineTransform) {
        context.restore();
      }
    }
    const passMs = performance.now() - passStarted;
    if (singleLinePass) {
      stats.lineMs += passMs;
    } else {
      stats.noteMs += passMs;
    }
  }
  return stats;
}
