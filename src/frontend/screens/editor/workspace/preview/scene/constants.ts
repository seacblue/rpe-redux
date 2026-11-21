/**
 * The preview's fixed logical stage size and the derived note and line scales
 * used to map authored values into that box. Note width follows Phira's
 * `note_scale`; line dimensions keep the Recorder-authored values. Hit-frame
 * timing is re-exported here so preview drawing code reads a single module.
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
 * `prpr` sizes the particle at `hitFxScale * note_scale / 5` world units while
 * a full note spans `2 * 0.13175016 * note_scale`, which reduces to this ratio.
 */
export const PHIRA_HIT_FX_WIDTH_RATIO = 1 / 5 / (2 * PHIRA_NOTE_WIDTH_RATIO);

/** Converts a Phira note scale into the 1350×900 chart box. */
export function previewNoteWidth(noteScale: number): number {
  return noteScale * PHIRA_NOTE_WIDTH_RATIO * PREVIEW_LOGICAL_SIZE.width;
}

/** Authoring width of a judge line, in stage pixels. */
export const DEFAULT_LINE_WIDTH = 4000;
/**
 * Authoring height of a judge line at `line_size = 1`.
 *
 * Recorder's height-scaled line thickness is `line_size * 2 * height / 405`;
 * at the canonical 900-unit height that is 4.444… stage units.
 */
export const DEFAULT_LINE_HEIGHT = (2 * PREVIEW_LOGICAL_SIZE.height) / 405;
