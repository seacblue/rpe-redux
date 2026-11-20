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
import { beatValue, fromNumber } from "../../global/chart/timing/beat.ts";
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
  startBeat?: number;
  endBeat?: number;
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

/** Creates one note at a target, validating hold geometry and line editability. */
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
  const startBeat = Math.min(target.from.beat, end.beat);
  const endBeat = Math.max(target.from.beat, end.beat);
  if (type === 2 && endBeat - startBeat <= EPSILON) {
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
  const startBeat = payload.startBeat ?? beatValue(note.startTime);
  const previousEnd = beatValue(note.endTime);
  const endBeat = type === 2 ? (payload.endBeat ?? previousEnd) : startBeat;
  return {
    ...note,
    type,
    positionX: payload.positionX ?? Number(note.positionX ?? 0),
    startTime: fromNumber(startBeat),
    endTime: fromNumber(endBeat),
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
  for (const [name, value] of [
    ["positionX", payload.positionX],
    ["startBeat", payload.startBeat],
    ["endBeat", payload.endBeat],
  ] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return rejected(`${name}.finite`);
    }
  }
  if (
    payload.nextType !== 2 &&
    payload.nextType !== undefined &&
    payload.endBeat !== undefined &&
    payload.startBeat !== undefined &&
    Math.abs(payload.endBeat - payload.startBeat) > EPSILON
  ) {
    return rejected("range.onlyHoldMayExtend");
  }
  return null;
}

/** Builds a rejected result carrying one issue code. */
function rejected(issue: string): ActionResult<never> {
  return { status: "rejected", reason: "invalid_input", issues: [issue] };
}
