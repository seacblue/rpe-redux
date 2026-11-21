/**
 * Note operations addressed by chart coordinates rather than by canvas position.
 *
 * Each operation validates its target, builds the edited chart and commits it
 * through the session, returning a structured result so the keyboard and plugin
 * paths report the same reason for a rejected edit.
 */
import { t } from "../../../i18n/index.ts";
import { countScoringNotes, createNote } from "../../global/chart/chart.ts";
import { lineAllowsNotes } from "../../global/chart/line/lineTraits.ts";
import type { JudgeLineNote } from "../../global/chart/chart.ts";
import {
  beatValue,
  fromNumber,
  isBeat,
  maxBeat,
  minBeat,
  normalizeBeat,
  toBeat,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import {
  validateActionTarget,
  type ActionResult,
  type ActionTarget,
  type CoordinateActionInput,
} from "../operations/result.ts";
import type { EditorSession } from "../session/session.ts";

type NoteType = 1 | 2 | 3 | 4;

interface NoteActionPayload {
  type?: NoteType;
  nextType?: NoteType;
  positionX?: number;
  startBeat?: number | Beat;
  endBeat?: number | Beat;
}

type NoteActionInput = CoordinateActionInput<NoteActionPayload>;

const NOTE_TYPES = new Set<NoteType>([1, 2, 3, 4]);
const EPSILON = 1e-6;

/**
 * The line a new note belongs to in merged multi-line mode.
 *
 * A merged field draws every selected line in one lane, so the requested line
 * — the author's active line — is the line to keep writing. A request outside
 * the merged selection moves to the first selected line so the note stays
 * visible in the field.
 */
export function resolveMergedNoteLine(session: EditorSession, fallback: number): number {
  if (session.notesMode !== "multi_merged") {
    return fallback;
  }
  return session.multiLineIndices.includes(fallback)
    ? fallback
    : (session.multiLineIndices[0] ?? fallback);
}

/** True when `input` is an object carrying a note-action target. */
export function isNoteActionInput(input: unknown): input is NoteActionInput {
  return Boolean(input && typeof input === "object" && "target" in input);
}

/** One action coordinate whose beat is already an exact triple. */
export interface BeatActionCoordinate {
  beat: Beat;
  positionX: number;
}

/** Exact-beat form of a note action target used by the pointer placement path. */
export interface BeatActionTarget {
  lineIndex: number;
  from: BeatActionCoordinate;
  to?: BeatActionCoordinate;
}

/** Creates one note at a numeric target, quantizing its beats over the default resolution. */
export function placeNoteAtTarget(
  session: EditorSession,
  type: NoteType,
  target: ActionTarget,
): ActionResult<JudgeLineNote> {
  if (!NOTE_TYPES.has(type)) {
    return rejected("type.unsupported");
  }
  const validation = validateActionTarget(target);
  if (validation) {
    return validation;
  }
  return placeNoteAtBeatTarget(session, type, {
    lineIndex: target.lineIndex,
    from: { beat: fromNumber(target.from.beat), positionX: target.from.positionX },
    to: target.to
      ? { beat: fromNumber(target.to.beat), positionX: target.to.positionX }
      : undefined,
  });
}

/** Creates one note at an exact-beat target, validating hold geometry and line editability. */
export function placeNoteAtBeatTarget(
  session: EditorSession,
  type: NoteType,
  target: BeatActionTarget,
): ActionResult<JudgeLineNote> {
  if (!NOTE_TYPES.has(type)) {
    return rejected("type.unsupported");
  }
  if (!Number.isInteger(target.lineIndex) || target.lineIndex < 0) {
    return rejected("target.lineIndex.nonNegativeInteger");
  }
  if (!isBeat(target.from.beat)) {
    return rejected("target.from.beat.invalid");
  }
  if (!Number.isFinite(target.from.positionX)) {
    return rejected("target.from.positionX.finite");
  }
  if (target.to && !isBeat(target.to.beat)) {
    return rejected("target.to.beat.invalid");
  }
  if (target.to && !Number.isFinite(target.to.positionX)) {
    return rejected("target.to.positionX.finite");
  }
  const beforeSelection = session.selectionState();
  const line = session.chart.judgeLineList?.[target.lineIndex];
  if (!line) {
    return rejected("target.lineIndex.exists");
  }
  const end = target.to ?? target.from;
  if (type === 2 && !target.to) {
    return rejected("to.requiredForHold");
  }
  if (type === 2 && Math.abs(target.from.positionX - end.positionX) > EPSILON) {
    return rejected("hold.positionX.mustMatch");
  }
  const startBeat = minBeat(target.from.beat, end.beat);
  const endBeat = maxBeat(target.from.beat, end.beat);
  if (type === 2 && beatValue(endBeat) - beatValue(startBeat) <= EPSILON) {
    return rejected("hold.range.nonZero");
  }
  const targetLineIndex = resolveMergedNoteLine(session, target.lineIndex);
  if (!lineAllowsNotes(session.chart.judgeLineList?.[targetLineIndex])) {
    return rejected("target.lineIndex.uneditable");
  }
  session.selectLine(targetLineIndex);
  session.focus = "notes";
  session.eventSelection.clear();
  const note = createNote(type, startBeat, target.from.positionX, endBeat);
  return session.insertNotesAt(
    targetLineIndex,
    [note],
    t("editor.session.addNotes"),
    beforeSelection,
  )
    ? { status: "committed", value: note }
    : rejected("target.lineIndex.uneditable");
}

/** Deletes notes matching a target and updates the line's scoring count. */
export function deleteNotesAtTarget(
  session: EditorSession,
  input: NoteActionInput,
): ActionResult<number> {
  const validation = validateNoteInput(input);
  if (validation) {
    return validation;
  }
  const target = input.target;
  const beforeSelection = session.selectionState();
  const line = session.chart.judgeLineList?.[target.lineIndex];
  if (!line) {
    return rejected("target.lineIndex.exists");
  }
  const indices = matchingNoteIndices(line.notes ?? [], target, input.payload?.type);
  if (!indices.length) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  session.selectLine(target.lineIndex);
  session.focus = "notes";
  session.eventSelection.clear();
  session.selection = new Set(indices);
  const removed = new Set(indices);
  const remaining = (line.notes ?? []).filter((_, index) => !removed.has(index));
  const previousScoring =
    typeof line.numOfNotes === "number" ? line.numOfNotes : countScoringNotes(line.notes);
  const removedScoring = indices.reduce(
    (count, index) => count + (line.notes?.[index]?.type === 2 ? 0 : 1),
    0,
  );
  session.selection.clear();
  session.commitChart(
    t("editor.session.deleteNotes"),
    {
      ...session.chart,
      judgeLineList: [
        ...(session.chart.judgeLineList ?? []).slice(0, target.lineIndex),
        {
          ...line,
          notes: remaining,
          numOfNotes: Math.max(0, previousScoring - removedScoring),
        },
        ...(session.chart.judgeLineList ?? []).slice(target.lineIndex + 1),
      ],
    },
    beforeSelection,
    {},
    { normalized: true },
  );
  return { status: "committed", value: indices.length };
}

/** Updates notes matching a target and commits the line once. */
export function updateNotesAtTarget(
  session: EditorSession,
  input: NoteActionInput,
): ActionResult<number> {
  const validation = validateNoteInput(input);
  if (validation) {
    return validation;
  }
  const payload = input.payload ?? {};
  const patchValidation = validateNotePatch(payload);
  if (patchValidation) {
    return patchValidation;
  }
  const target = input.target;
  const beforeSelection = session.selectionState();
  const line = session.chart.judgeLineList?.[target.lineIndex];
  if (!line) {
    return rejected("target.lineIndex.exists");
  }
  const indices = matchingNoteIndices(line.notes ?? [], target, payload.type);
  if (!indices.length) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  const selected = new Set(indices);
  const notes = (line.notes ?? []).map((note, index) =>
    selected.has(index) ? updateNote(note, payload) : note,
  );
  if (notes.every((note, index) => note === line.notes?.[index])) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  session.selectLine(target.lineIndex);
  session.focus = "notes";
  session.eventSelection.clear();
  session.selection = selected;
  const previousScoring =
    typeof line.numOfNotes === "number" ? line.numOfNotes : countScoringNotes(line.notes);
  const scoringDelta = indices.reduce((delta, index) => {
    const before = line.notes?.[index];
    const after = notes[index];
    return delta + (after?.type === 2 ? 0 : 1) - (before?.type === 2 ? 0 : 1);
  }, 0);
  session.commitChart(
    t("editor.session.updateNotes"),
    {
      ...session.chart,
      judgeLineList: [
        ...(session.chart.judgeLineList ?? []).slice(0, target.lineIndex),
        { ...line, notes, numOfNotes: Math.max(0, previousScoring + scoringDelta) },
        ...(session.chart.judgeLineList ?? []).slice(target.lineIndex + 1),
      ],
    },
    beforeSelection,
    {},
    { normalized: true },
  );
  return { status: "committed", value: indices.length };
}

/** Applies a note patch, keeping non-hold notes instantaneous. */
function updateNote(note: JudgeLineNote, payload: NoteActionPayload): JudgeLineNote {
  const type = payload.nextType ?? note.type;
  const startBeat =
    payload.startBeat === undefined ? normalizeBeat(note.startTime) : toBeat(payload.startBeat);
  const previousEnd = normalizeBeat(note.endTime);
  const endBeat =
    type === 2
      ? payload.endBeat === undefined
        ? previousEnd
        : toBeat(payload.endBeat)
      : startBeat;
  return {
    ...note,
    type,
    positionX: payload.positionX ?? Number(note.positionX ?? 0),
    startTime: startBeat,
    endTime: endBeat,
  };
}

/** Indices of notes inside the target's beat/X range, optionally of one type. */
function matchingNoteIndices(
  notes: readonly JudgeLineNote[],
  target: ActionTarget,
  type?: NoteType,
): number[] {
  const range = target.to
    ? {
        startBeat: Math.min(target.from.beat, target.to.beat),
        endBeat: Math.max(target.from.beat, target.to.beat),
        startX: Math.min(target.from.positionX, target.to.positionX),
        endX: Math.max(target.from.positionX, target.to.positionX),
      }
    : {
        startBeat: target.from.beat,
        endBeat: target.from.beat,
        startX: target.from.positionX,
        endX: target.from.positionX,
      };
  return notes.reduce<number[]>((matches, note, index) => {
    const beat = beatValue(note.startTime);
    const positionX = Number(note.positionX ?? 0);
    const beatMatches = target.to
      ? beat >= range.startBeat - EPSILON && beat <= range.endBeat + EPSILON
      : Math.abs(beat - range.startBeat) <= EPSILON;
    const xMatches = positionX >= range.startX - EPSILON && positionX <= range.endX + EPSILON;
    if (beatMatches && xMatches && (type === undefined || note.type === type)) {
      matches.push(index);
    }
    return matches;
  }, []);
}

/** Validates a note action's target and note-type fields. */
function validateNoteInput(input: NoteActionInput): ActionResult<never> | null {
  if (!input || !input.target) {
    return rejected("target.required");
  }
  const targetValidation = validateActionTarget(input.target);
  if (targetValidation) {
    return targetValidation;
  }
  const payload = input.payload;
  if (payload?.type !== undefined && !NOTE_TYPES.has(payload.type)) {
    return rejected("type.unsupported");
  }
  if (payload?.nextType !== undefined && !NOTE_TYPES.has(payload.nextType)) {
    return rejected("nextType.unsupported");
  }
  return null;
}

/** Validates finite coordinates and hold-only beat ranges. */
function validateNotePatch(payload: NoteActionPayload): ActionResult<never> | null {
  if (
    payload.positionX !== undefined &&
    (typeof payload.positionX !== "number" || !Number.isFinite(payload.positionX))
  ) {
    return rejected("positionX.finite");
  }
  for (const [name, value] of [
    ["startBeat", payload.startBeat],
    ["endBeat", payload.endBeat],
  ] as const) {
    if (value !== undefined && !validBeatInput(value)) {
      return rejected(`${name}.invalid`);
    }
  }
  if (
    payload.nextType !== 2 &&
    payload.nextType !== undefined &&
    payload.endBeat !== undefined &&
    payload.startBeat !== undefined &&
    Math.abs(beatValue(toBeat(payload.endBeat)) - beatValue(toBeat(payload.startBeat))) > EPSILON
  ) {
    return rejected("range.onlyHoldMayExtend");
  }
  return null;
}

/** True for a finite numeric beat or a structurally valid triple. */
function validBeatInput(value: number | readonly number[]): boolean {
  return typeof value === "number" ? Number.isFinite(value) : isBeat(value);
}

/** Builds a rejected result carrying one issue code. */
function rejected(issue: string): ActionResult<never> {
  return { status: "rejected", reason: "invalid_input", issues: [issue] };
}
