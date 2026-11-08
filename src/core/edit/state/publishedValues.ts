/**
 * The editor's values.
 *
 * These are the numbers and flags the toolbar fields show, the transport
 * publishes and a script may read: declared once here, read and written through
 * `core/state/values.ts`, and rendered nowhere. A toolbar row names an id and the field
 * draws it, which is why a field is data and not a component of its own.
 *
 * The split from settings is deliberate. A value that belongs to the *document*
 * — the subdivision, the grid count, the chart offset — is not declared durable
 * here: it is written by the project's own save, and a preferences file that
 * carried it would fight the chart the user opens next.
 */
import { defineValue } from "../../state/values.ts";

/** The judgeline the editor is on, as the line field's text. */
export const editorLine = defineValue({ id: "editor.line", initial: "0" });

/** What the toolbar's line field displays: the active line or the compact selection. */
export const editorLineInput = defineValue({ id: "editor.lineInput", initial: "0" });

/** A stable, label-ready view of one judge line for the toolbar picker. */
export interface EditorLineOption {
  index: number;
  /** The full localized label, number included. */
  label: string;
  /** The group and line name without the number, so a list can draw a tab column. */
  name: string;
  group: string;
}

/** The label of every judgeline, so the line field can say what the index holds. */
export const editorLineLabels = defineValue({
  id: "editor.lineLabels",
  initial: [] as readonly string[],
});

/** Folder-grouped line labels for the toolbar selection popover. */
export const editorLineOptions = defineValue({
  id: "editor.lineOptions",
  initial: [] as readonly EditorLineOption[],
});

/**
 * The shared line selection owned by the toolbar.
 *
 * Multi-line editing is a separate flag. Keeping the set independent is what
 * lets the user select lines for batch properties without switching the
 * timeline into multi-line rendering.
 */
export const editorLineSelection = defineValue({
  id: "editor.lineSelection",
  initial: [] as readonly number[],
});

/**
 * The judge-line folder the tree has selected, or null while a line is.
 *
 * Folder mode and `editor.lineSelection` are mutually exclusive: selecting a
 * folder clears the line selection, and any non-empty line selection leaves
 * folder mode. The line panel's selection helper owns that rule, so writers do
 * not each repeat half of it.
 */
export const editorLineFolderGroup = defineValue<number | null>({
  id: "editor.lineFolderGroup",
  initial: null,
});

/** Whether the multi-line editor is using the shared line selection. */
export const editorMultiLineEnabled = defineValue({
  id: "editor.multiLineEnabled",
  initial: false,
});

/** A chart with one line has nowhere to step, so the field is disabled. */
export const editorLineNavigationDisabled = defineValue({
  id: "editor.lineNavigationDisabled",
  initial: true,
});

/** How many parts one beat is cut into. Drafted by the field, committed by the editor. */
export const editorDivision = defineValue({ id: "editor.division", initial: "4" });

/** How many grid lines one beat is drawn with. Same drafting rule as the subdivision. */
export const editorGridCount = defineValue({ id: "editor.gridCount", initial: "11" });

/**
 * The aspect ratio the stage previews at.
 *
 * Starts at the ratio the preview opens with, so the field shows what the canvas
 * is doing before anyone touches it; the editor writes it back whenever the
 * ratio is re-applied from the settings.
 */
export const editorPreviewRatio = defineValue({ id: "editor.previewRatio", initial: "4:3" });

/** How fast the transport runs. The rate field writes it, the editor applies it. */
export const editorRate = defineValue({ id: "editor.rate", initial: "1" });

/** The chart's audio offset in milliseconds, published by the editor. */
export const editorOffset = defineValue({ id: "editor.offset", initial: "0" });

/** The beat the seek action jumps to. A script sets it; nothing draws it. */
export const editorSeekBeat = defineValue({ id: "editor.seekBeat", initial: "0" });

/** Whether the transport is running. Published by the frame loop, drawn by the play button. */
export const editorPlaying = defineValue({ id: "editor.playing", initial: false });

/** Active A-B loop range in audio seconds, or null while the loop is inactive. */
export interface EditorLoopRange {
  readonly start: number;
  readonly end: number;
}

const sameLoopRange = (left: EditorLoopRange | null, right: EditorLoopRange | null): boolean =>
  left === right ||
  (left !== null && right !== null && left.start === right.start && left.end === right.end);

/** The active editor A-B range in audio seconds, highlighted on the full-track progress bar. */
export const editorLoopRange = defineValue<EditorLoopRange | null>({
  id: "editor.loopRange",
  initial: null,
  equals: sameLoopRange,
});

/**
 * The library project behind the open document, or an empty string.
 *
 * Import reports are keyed by project, so the title bar needs the current one to
 * decide whether to show the compatibility badge.
 */
export const editorProjectId = defineValue({ id: "editor.projectId", initial: "" });

/**
 * Whether a hold-to-audition gesture owns the transport.
 *
 * The audio clock is running during audition, but the play button does not look
 * active or accept a second transport action while the hold is active. The
 * gesture may also focus the preview and restore the layout on release.
 */
export const editorAuditioning = defineValue({
  id: "editor.auditioning",
  initial: false,
});

/** How many milliseconds one beat occupies on screen. */
export const editorScale = defineValue({ id: "editor.scale", initial: "500" });

/** Whether dragging and placing snap to the beat. */
export const editorSnapX = defineValue({ id: "editor.snapX", initial: true });

/** Whether the stage draws the realtime preview. */
export const editorRealtimePreviewEnabled = defineValue({
  id: "editor.realtimePreviewEnabled",
  initial: true,
});

/**
 * Whether the timeline is drawn as more than one panel.
 *
 * Published by the session renderer from the live session object, the same way the
 * transport publishes `editor.playing`: the session owns the flag, and this is where
 * a component that must not reach into the session reads it.
 */
export const editorMultiLineActive = defineValue({
  id: "editor.multiLineActive",
  initial: false,
});

/** Which area the multi-panel timeline edits. Read with `editorMultiLineActive`. */
export const editorMultiLineMode = defineValue<"notes" | "events">({
  id: "editor.multiLineMode",
  initial: "notes",
});

/** Whether multi-line notes share one combined field; false gives each line its own. */
export const editorMultiLineMerge = defineValue({
  id: "editor.multiLineMerge",
  initial: true,
});
