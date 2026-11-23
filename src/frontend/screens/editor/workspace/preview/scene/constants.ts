/**
 * The preview's fixed logical stage size and the derived note and line scales
 * used to map authored values into that box. Note and judge-line dimensions
 * follow Phira's authored defaults while remaining Redux-owned rendering
 * constants. Hit-frame timing is re-exported here so preview drawing code
 * reads a single module.
 */

export {
  HIT_DURATION,
  HIT_FRAME_COUNT,
  HIT_FRAME_SECONDS,
  hitFrame,
} from "../../../canvas/hitFrame.ts";

/** The logical chart box used by preview rendering and overlay placement. */
export const PREVIEW_LOGICAL_SIZE = { width: 1350, height: 900 } as const;

/**
 * Phira's full note width as a fraction of the stage width.
 *
 * `prpr` stores a half-width of 0.13175016 in a two-unit-wide world, so a note
 * spans 13.175% of the rendered width at `note_scale = 1`.
 */
export const PHIRA_NOTE_WIDTH_RATIO = 0.13175016;

export {
  PHIRA_NOTE_SCALE_DEFAULT,
  PHIRA_NOTE_SCALE_MAX,
  PHIRA_NOTE_SCALE_MIN,
} from "../../../../../../core/media/noteSkin.ts";

/**
 * Phira's hit-effect sprite side as a fraction of the full note width.
 *
 * `prpr` sizes the particle mesh at `hitFxScale * note_scale / 5` world
 * half-width while a note mesh has half-width `note_scale * ratio`. Both
 * meshes use the same `-1..1` quad, so the full-width ratio is `1 / (5 *
 * ratio)`.
 */
export const PHIRA_HIT_FX_WIDTH_RATIO = 1 / 5 / PHIRA_NOTE_WIDTH_RATIO;

/** Converts a Phira note scale into the 1350×900 chart box. */
export function previewNoteWidth(noteScale: number): number {
  return noteScale * PHIRA_NOTE_WIDTH_RATIO * PREVIEW_LOGICAL_SIZE.width;
}

/** The fixed authoring length of a default judge line, in stage pixels. */
export const DEFAULT_LINE_WIDTH = 4000;
/**
 * Authoring height of a judge line at Phira's default `line_size = 0.01`.
 *
 * The Phira line width is measured in the same two-unit world span as the
 * 1350-pixel RPE width, so 0.01 world units are 6.75 stage pixels.
 */
export const DEFAULT_LINE_HEIGHT = (PREVIEW_LOGICAL_SIZE.width / 2) * 0.01;
