/**
 * Presence checks for optional RPE editing features.
 *
 * A feature setting hides the editor entry points for a capability, but never
 * hides data a chart already carries. These predicates separate "the user has
 * this capability enabled" from "this line, note or event actually uses it".
 */
import {
  lineParentIndex,
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
} from "./chart.ts";
import { clamp01 } from "../../utils/numbers.ts";

/** A parent relation is an actual editable relation, not the default `-1`. */
export function lineHasParent(line: JudgeLine | undefined): boolean {
  if (!line) {
    return false;
  }
  const parent = lineParentIndex(line.father);
  return Number.isInteger(parent) && parent >= 0;
}

/** True when the line carries any event in its extended track map. */
export function lineHasExtendedEvents(line: JudgeLine | undefined): boolean {
  return Object.values(line?.extended ?? {}).some(
    (track) => Array.isArray(track) && track.length > 0,
  );
}

/** True when any line in the chart uses an extended event track. */
export function chartHasExtendedEvents(chart: Chart | undefined): boolean {
  return (chart?.judgeLineList ?? []).some(lineHasExtendedEvents);
}

/** True when that numbered base layer contains at least one event. */
export function lineHasEventLayer(line: JudgeLine | undefined, index: number): boolean {
  const layer = line?.eventLayers?.[index];
  return Boolean(
    layer && Object.values(layer).some((track) => Array.isArray(track) && track.length > 0),
  );
}

/** True when the event belongs to a link group; `0` is the unlinked default. */
export function eventHasLinkGroup(event: JudgeLineEvent | undefined): boolean {
  return Number(event?.linkgroup ?? 0) > 0;
}

/** True when the chart uses a non-default line BPM factor. */
export function lineHasCustomBpmFactor(line: JudgeLine | undefined): boolean {
  return Number(line?.bpmfactor ?? 1) !== 1;
}

/** True when the line uses an anchor other than the visual centre. */
export function lineHasCustomAnchor(line: JudgeLine | undefined): boolean {
  const anchor = line?.anchor;
  return (
    Array.isArray(anchor) &&
    anchor.length >= 2 &&
    (Number(anchor[0]) !== 0.5 || Number(anchor[1]) !== 0.5)
  );
}

/** Note-level optional visual fields use their format defaults as absence. */
export function noteHasCustomSpeed(note: JudgeLineNote | undefined): boolean {
  return Number(note?.speed ?? 1) !== 1;
}

/** True when the note carries a non-default size multiplier. */
export function noteHasCustomSize(note: JudgeLineNote | undefined): boolean {
  return Number(note?.size ?? 1) !== 1;
}

/** True when the note's alpha differs from the opaque default of 255. */
export function noteHasCustomAlpha(note: JudgeLineNote | undefined): boolean {
  return Number(note?.alpha ?? 255) !== 255;
}

/** Return the authored note alpha normalized for every visual renderer. */
export function noteAlpha(note: JudgeLineNote | undefined): number {
  return clamp01(Number(note?.alpha ?? 255) / 255);
}

/** True when the note carries a non-zero vertical offset. */
export function noteHasCustomYOffset(note: JudgeLineNote | undefined): boolean {
  return Number(note?.yOffset ?? 0) !== 0;
}

/** True when the note overrides the default visible-time window. */
export function noteHasCustomVisibleTime(note: JudgeLineNote | undefined): boolean {
  return Number(note?.visibleTime ?? 999999) !== 999999;
}

/** Custom note colour is an authored RGB triple, not a default value. */
export function noteHasColor(note: JudgeLineNote | undefined): boolean {
  const value = note as (JudgeLineNote & { tint?: unknown; color?: unknown }) | undefined;
  return Array.isArray(value?.color) || Array.isArray(value?.tint);
}

/** RPE accepts both spellings; either one is authored hit-sound data. */
export function noteHasHitSound(note: JudgeLineNote | undefined): boolean {
  const value = note as (JudgeLineNote & { hitSound?: unknown; hitsound?: unknown }) | undefined;
  return Boolean(
    (typeof value?.hitSound === "string" && value.hitSound) ||
    (typeof value?.hitsound === "string" && value.hitsound),
  );
}

/** Fake notes are a per-note property, not a chart-wide flag. */
export function noteIsFake(note: JudgeLineNote | undefined): boolean {
  return Boolean(note && Number(note.isFake) === 1);
}

/** True when the event uses Bézier easing. */
export function eventUsesBezier(event: JudgeLineEvent | undefined): boolean {
  return Boolean(event?.bezier);
}
