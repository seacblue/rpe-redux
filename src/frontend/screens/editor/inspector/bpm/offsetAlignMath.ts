/**
 * The math behind aligning the chart offset to a timeline line.
 *
 * Aligning never moves the audio: the playhead keeps its audio position and the
 * chart slides so the picked line lands under it. That makes the target offset
 * `audio − chart`, because `chart = audio − offset`.
 */

/** How close a press must land to a grid line before the pick accepts it. */
export const OFFSET_ALIGN_LINE_RADIUS_PX = 6;

/**
 * The offset, in milliseconds, that puts `chartSeconds` under `audioSeconds`.
 *
 * Returns null when either clock reading is unusable, which leaves the offset
 * untouched instead of committing a non-finite value.
 */
export function alignedOffsetMs(audioSeconds: number, chartSeconds: number): number | null {
  const offsetMs = (audioSeconds - chartSeconds) * 1000;
  if (
    !Number.isFinite(audioSeconds) ||
    !Number.isFinite(chartSeconds) ||
    !Number.isFinite(offsetMs)
  ) {
    return null;
  }
  return Math.round(offsetMs);
}

/** The grid line a press at `vertical` would snap to, or null when it misses them. */
export interface OffsetAlignLineHit {
  /** The line's own canvas y, which the caller turns back into a beat. */
  readonly vertical: number;
  /** Distance in pixels from the press to that line. */
  readonly distance: number;
}

/**
 * Resolve the visible grid line nearest to a press, or null when none is close.
 *
 * Verticals are canvas y positions in the same space the lines are painted in.
 * The press must land within `OFFSET_ALIGN_LINE_RADIUS_PX`; open canvas is
 * refused instead of snapping to a distant line, so a miss keeps the pick armed.
 */
export function offsetAlignLineAt(
  vertical: number,
  lineVerticals: Iterable<number>,
): OffsetAlignLineHit | null {
  if (!Number.isFinite(vertical)) {
    return null;
  }
  let nearest: OffsetAlignLineHit | null = null;
  for (const lineVertical of lineVerticals) {
    if (!Number.isFinite(lineVertical)) {
      continue;
    }
    const distance = Math.abs(lineVertical - vertical);
    if (nearest === null || distance < nearest.distance) {
      nearest = { vertical: lineVertical, distance };
    }
  }
  return nearest !== null && nearest.distance <= OFFSET_ALIGN_LINE_RADIUS_PX ? nearest : null;
}

/** Find the pressed grid line among the visible beats, or null for a miss. */
export function offsetAlignBeatAt(
  vertical: number,
  firstBeat: number,
  lastBeat: number,
  division: number,
  verticalAtBeat: (beat: number) => number,
): number | null {
  if (!Number.isFinite(vertical) || !Number.isFinite(division) || division <= 0) {
    return null;
  }
  const step = 1 / division;
  const from = Math.floor(Math.min(firstBeat, lastBeat) / step) * step;
  const to = Math.ceil(Math.max(firstBeat, lastBeat) / step) * step;
  const beats: number[] = [];
  const verticals: number[] = [];
  // Only the visible range is walked, and one press resolves a handful of
  // thousand ticks at most, so the nearest-line scan stays off the paint path.
  for (let beat = from; beat <= to + 1e-9; beat += step) {
    const lineVertical = verticalAtBeat(beat);
    if (!Number.isFinite(lineVertical)) {
      continue;
    }
    beats.push(beat);
    verticals.push(lineVertical);
  }
  const hit = offsetAlignLineAt(vertical, verticals);
  if (!hit) {
    return null;
  }
  const index = verticals.indexOf(hit.vertical);
  return index >= 0 ? beats[index] : null;
}
