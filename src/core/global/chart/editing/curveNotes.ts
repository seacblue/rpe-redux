/**
 * Generates notes that approximate a curved authoring gesture.
 *
 * The caller supplies beat and horizontal endpoints plus density/easing options;
 * this module owns chart-note construction and validation. It does not mutate a
 * chart, choose a selection, or decide how the inspector presents the result.
 * The preview and the commit both consume `planCurveNotes`, which caches its last
 * plan by complete input signature, so an anchor already present in the chart is
 * never previewed as new or inserted twice and the two paths share one
 * generation.
 */
import { t } from "../../../../i18n/index.ts";
import {
  addBeatFraction,
  beatCopy,
  beatValue,
  compareBeats,
  subtractBeats,
  type Beat,
} from "../timing/beat.ts";
import { createNote } from "../chart.ts";
import { easing } from "../../../utils/easing.ts";
import type { JudgeLineNote } from "../chart.ts";

/** Inputs for a curved note run: endpoints in beats and position, plus spacing. */
export interface CurveNoteOptions {
  startTime: Beat;
  endTime: Beat;
  startX: number;
  endX: number;
  type?: number;
  division?: number;
  density?: number;
  easingType?: number;
}

/**
 * How many `1/denominator` steps fit strictly between the two beats.
 *
 * Counted on the exact triples: the count is the floor of
 * `distance * denominator`, so a point that lands on the end beat is dropped.
 */
function gridPointCount(startTime: Beat, endTime: Beat, denominator: number): number {
  const distance = subtractBeats(endTime, startTime);
  const scaled =
    BigInt(denominator) * (BigInt(distance[0]) * BigInt(distance[2]) + BigInt(distance[1]));
  const divisor = BigInt(distance[2]);
  const count = scaled <= 0n ? 0n : (scaled - 1n) / divisor;
  if (count > 20000n) {
    throw new Error(t("model.curveNotes.tooManyNotes", { count: Number(count) }));
  }
  return Number(count);
}

/**
 * Generate notes along a curved run between two beats and X positions.
 *
 * Throws when the range, position/division options or note type are invalid, and
 * when the requested density exceeds 20,000 notes.
 */
export function generateCurveNotes({
  startTime,
  endTime,
  startX,
  endX,
  type = 4,
  division = 4,
  density = 1,
  easingType = 1,
}: CurveNoteOptions): JudgeLineNote[] {
  const start = beatValue(startTime);
  const end = beatValue(endTime);
  if (compareBeats(startTime, [0, 0, 1]) < 0 || compareBeats(endTime, startTime) < 0) {
    throw new Error(t("model.curveNotes.invalidRange"));
  }
  if (
    ![startX, endX, density, division].every(Number.isFinite) ||
    density <= 0 ||
    density > 1000 ||
    division < 1 ||
    division > 100
  ) {
    throw new Error(t("model.curveNotes.invalidOptions"));
  }
  if (
    ![1, 2, 3, 4].includes(type) ||
    !Number.isInteger(easingType) ||
    easingType < 1 ||
    easingType > 29
  ) {
    throw new Error(t("model.curveNotes.invalidType"));
  }
  const denominator = Math.max(1, Math.trunc(division * density));
  const sameBeat = compareBeats(startTime, endTime) === 0;
  const count = sameBeat ? Math.ceil(density) : gridPointCount(startTime, endTime, denominator);
  if (count > 20000) {
    throw new Error(t("model.curveNotes.tooManyNotes", { count }));
  }
  return Array.from({ length: count }, (unused, index) => {
    const amount = sameBeat
      ? (index + 1) / (density + 1)
      : (index + 1) / denominator / (end - start);
    const position = startX + (endX - startX) * (sameBeat ? amount : easing(amount, easingType));
    // `start + (index + 1)/denominator`, exact: the intermediate notes of a
    // curve are grid points of the start beat, not 10000ths of a float.
    const beat = sameBeat
      ? beatCopy(startTime)
      : addBeatFraction(startTime, index + 1, denominator);
    // A Hold curve uses one horizontal grid step as every body: the current
    // division is the number of lines in a beat, so each hold is 1/division.
    const endBeat =
      type === 2 ? addBeatFraction(beat, 1, Math.max(1, Math.trunc(division))) : beatCopy(beat);
    return { ...createNote(type, 0, position), startTime: beat, endTime: endBeat };
  });
}

/** Inputs for a curve note plan; `existing` is the target line's current notes. */
export interface CurveNotePlanOptions extends CurveNoteOptions {
  /** Notes already on the target line; an anchor matching one is reused. */
  existing?: readonly JudgeLineNote[];
}

/** Stable identity token for one note list, used to key curve plan caches. */
const noteListTokens = new WeakMap<readonly JudgeLineNote[], number>();
const noteTokens = new WeakMap<object, number>();
let nextNoteListToken = 1;
let nextNoteToken = 1;

/** Identity token for one note object; notes are replaced rather than mutated. */
function noteToken(note: JudgeLineNote | undefined): number {
  if (!note) {
    return 0;
  }
  let token = noteTokens.get(note);
  if (token === undefined) {
    token = nextNoteToken++;
    noteTokens.set(note, token);
  }
  return token;
}

/**
 * Fingerprint a note list by reference, length, and boundary identities.
 *
 * Chart edits replace the array or its affected notes, so this token changes
 * whenever the plan's `existing` input changes without scanning every note on
 * each preview frame.
 */
export function curveNoteListToken(notes: readonly JudgeLineNote[]): string {
  if (!notes.length) {
    return "empty";
  }
  let listToken = noteListTokens.get(notes);
  if (listToken === undefined) {
    listToken = nextNoteListToken++;
    noteListTokens.set(notes, listToken);
  }
  const middle = notes[Math.floor((notes.length - 1) / 2)];
  return [
    listToken,
    notes.length,
    noteToken(notes[0]),
    noteToken(middle),
    noteToken(notes.at(-1)),
  ].join(":");
}

/** One point of a curve note plan and whether the chart already holds it. */
export interface CurveNotePlanItem {
  note: JudgeLineNote;
  /** The chart already holds this anchor at the same beat and X. */
  existing: boolean;
}

/** The preview path and the exact notes a curve commit appends. */
export interface CurveNotePlan {
  /** Every point of the path in order, with reused anchors marked. */
  items: CurveNotePlanItem[];
  /** Generated intermediate notes, excluding both anchors. */
  generated: JudgeLineNote[];
  /** Notes to append: generated points plus anchors the chart does not hold. */
  notes: JudgeLineNote[];
}

/** Build one curve anchor at an exact beat and X; a Hold spans one division. */
export function createCurveAnchorNote(
  type: number,
  startTime: Beat,
  positionX: number,
  division = 4,
): JudgeLineNote {
  return {
    ...createNote(type, 0, positionX),
    startTime: beatCopy(startTime),
    endTime:
      type === 2
        ? addBeatFraction(startTime, 1, Math.max(1, Math.trunc(division)))
        : beatCopy(startTime),
  };
}

/** Whether two notes share both their start beat and horizontal position. */
export function curveNoteMatches(left: JudgeLineNote, right: JudgeLineNote): boolean {
  return (
    left.positionX === right.positionX && beatValue(left.startTime) === beatValue(right.startTime)
  );
}

/** Counters for the last-plan cache shared by the preview and the commit. */
export interface CurvePlanCacheStats {
  /** A caller reused the cached plan for the same inputs. */
  hits: number;
  /** A caller needed a new plan for different inputs. */
  misses: number;
  /** Whether one plan is currently cached. */
  entries: number;
}

/** Inputs that fully determine one curve plan, in cache-key form. */
function curvePlanKey(options: CurveNotePlanOptions, existing: readonly JudgeLineNote[]): string {
  return [
    options.startTime.join("/"),
    options.endTime.join("/"),
    options.startX,
    options.endX,
    options.type ?? 4,
    options.division ?? 4,
    options.density ?? 1,
    options.easingType ?? 1,
    curveNoteListToken(existing),
  ].join("|");
}

const EMPTY_CURVE_NOTES: readonly JudgeLineNote[] = [];
let cachedPlan: { key: string; plan: CurveNotePlan } | null = null;
let cacheHits = 0;
let cacheMisses = 0;

/** Report the shared plan cache's hit and miss counts for tests and diagnostics. */
export function curvePlanCacheStats(): CurvePlanCacheStats {
  return { hits: cacheHits, misses: cacheMisses, entries: cachedPlan ? 1 : 0 };
}

/** Drop the cached plan and reset its counters. */
export function resetCurvePlanCache(): void {
  cachedPlan = null;
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Build the curve plan shared by the timeline preview and the commit.
 *
 * Anchors already present at the same beat and X stay on the preview path but
 * are omitted from `notes`, so the ghost and the commit insert the same notes.
 * The last plan is cached by its complete input signature, so the ghost redraw
 * and the subsequent commit reuse one generation. Callers treat the result as
 * read-only.
 */
export function planCurveNotes(options: CurveNotePlanOptions): CurveNotePlan {
  const existing = options.existing ?? EMPTY_CURVE_NOTES;
  const key = curvePlanKey(options, existing);
  if (cachedPlan?.key === key) {
    cacheHits += 1;
    return cachedPlan.plan;
  }
  cacheMisses += 1;
  const type = options.type ?? 4;
  const generated = generateCurveNotes(options);
  const start = createCurveAnchorNote(
    type,
    options.startTime,
    options.startX,
    options.division ?? 4,
  );
  const items: CurveNotePlanItem[] = [
    {
      note: start,
      existing: existing.some((note) => curveNoteMatches(note, start)),
    },
    ...generated.map((note) => ({ note, existing: false })),
  ];
  if (compareBeats(options.startTime, options.endTime) !== 0) {
    const end = createCurveAnchorNote(type, options.endTime, options.endX, options.division ?? 4);
    items.push({
      note: end,
      existing: existing.some((note) => curveNoteMatches(note, end)),
    });
  }
  const plan: CurveNotePlan = {
    items,
    generated,
    notes: items.filter((item) => !item.existing).map((item) => item.note),
  };
  cachedPlan = { key, plan };
  return plan;
}
