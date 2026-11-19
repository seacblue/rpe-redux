/**
 * Derives the absolute-time hit-sound trigger list from a chart's notes.
 *
 * Note types and custom hitsound names map to tap, drag, flick and custom offsets,
 * with each line's beat factor applied through the tempo grid.
 */
import type { Chart, JudgeLine } from "../global/chart/chart.ts";
import type { TempoGrid } from "../global/chart/editing/editGrid.ts";

/** A chart-derived sound trigger in absolute seconds. */
export interface HitTimelineEntry {
  time: number;
  sound: string;
}

/** Timing offset per sound kind, in seconds. */
export type HitSoundOffsetMap = Partial<Record<"tap" | "drag" | "flick" | "custom", number>>;

/** The built-in hit sound a note type plays when the note has no custom sound. */
export function defaultHitSound(type: number): "tap" | "drag" | "flick" {
  return type === 3 ? "flick" : type === 4 ? "drag" : "tap";
}

/** The note's authored custom hit sound, or undefined when it uses the type default. */
export function noteHitSound(note: {
  hitsound?: unknown;
  hitSound?: unknown;
  [extra: string]: unknown;
}): string | undefined {
  const value = note.hitsound || note.hitSound;
  return typeof value === "string" && value ? value : undefined;
}

/** True when a sound name already names a built-in note sound of the format. */
export function isBuiltInHitSound(value: unknown): boolean {
  return value === "tap" || value === "drag" || value === "flick" || value === "hold";
}

/** Resolve the offset for a note from either an offset pair or the kind map. */
function offsetFor(offsets: number[] | HitSoundOffsetMap, noteType: number, sound: string): number {
  if (Array.isArray(offsets)) {
    return noteType === 4 ? (offsets[1] ?? 0) : (offsets[0] ?? 0);
  }
  const kind = sound === "tap" || sound === "drag" || sound === "flick" ? sound : "custom";
  return offsets[kind] ?? 0;
}

/**
 * Build the sorted hit-sound triggers for a chart.
 *
 * Pass a `lineIndex` to include only that judge line. Offsets are added after the
 * chart's audio offset and the line's beat factor.
 */
export function hitTimeline(
  chart: Chart,
  tempo: TempoGrid,
  offsets: number[] | HitSoundOffsetMap = [0, 0],
  lineIndex: number | null = null,
): HitTimelineEntry[] {
  const entries: HitTimelineEntry[] = [];
  const lines: JudgeLine[] =
    lineIndex === null || lineIndex === undefined
      ? (chart.judgeLineList ?? [])
      : [chart.judgeLineList?.[lineIndex]].filter((line): line is JudgeLine => Boolean(line));
  for (const line of lines) {
    for (const note of line.notes ?? []) {
      if (note.isFake) {
        continue;
      }
      const custom = noteHitSound(note);
      const sound = custom ? (custom === "hold" ? "tap" : custom) : defaultHitSound(note.type);
      entries.push({
        time:
          tempo.seconds(note.startTime, line.bpmfactor ?? 1) +
          (chart.META.offset ?? 0) / 1000 +
          offsetFor(offsets, note.type, sound),
        sound,
      });
    }
  }
  return entries.sort((left, right) => left.time - right.time);
}
