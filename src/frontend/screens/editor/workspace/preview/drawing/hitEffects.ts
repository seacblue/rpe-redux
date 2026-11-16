/**
 * Which notes are inside a hit animation right now, and what each one shows.
 *
 * The preview plays an effect for every note the playhead has just crossed, so
 * this looks the current second up in an interval index, keeps the notes whose
 * animation window is open, and answers with the frame each one is on. The
 * reading half of the effect; `render/` draws what it returns.
 */
import { upperBound } from "../../../../../../core/utils/search.ts";
import type { IntervalIndex } from "../../../../../../core/utils/intervalIndex.ts";
import type { NoteEntry } from "../../../../../../core/global/chart/runtime/scene.ts";

/** Seconds between repeated hold-hit pulses. */
export const HOLD_HIT_INTERVAL = 20 / 120;

/** The slice of `LineRuntime` the hit feed reads. */
export interface HitRuntime {
  hitTimes: NoteEntry[];
  holdIndex: IntervalIndex<NoteEntry>;
}

interface HitTimeCursor {
  hitTimes: NoteEntry[];
  seconds: number;
  since: number;
  lifetime: number;
  first: number;
  last: number;
}

const hitTimeCursors = new WeakMap<HitRuntime, HitTimeCursor>();

/** One rendered hit: the note entry, its time in seconds, and its particle seed. */
export interface Hit {
  entry: NoteEntry;
  time: number;
  seed: number;
}

/** Fill a caller-owned hit buffer for a frame without allocating a hit array. */
export function recentHitsInto(
  runtime: HitRuntime,
  seconds: number,
  since: number,
  hits: Hit[],
  lifetime = 2 / 3,
): number {
  hits.length = 0;
  const lower = Math.max(seconds - lifetime, since);
  const hitTimes = runtime.hitTimes;
  if (hitTimes.length === 0) {
    return 0;
  }
  const cached = hitTimeCursors.get(runtime);
  let first: number;
  let last: number;
  if (
    cached &&
    cached.hitTimes === hitTimes &&
    cached.since === since &&
    cached.lifetime === lifetime &&
    seconds >= cached.seconds
  ) {
    first = cached.first;
    while (first < hitTimes.length && hitTimes[first].start <= lower) {
      first += 1;
    }
    last = cached.last;
    while (last < hitTimes.length && hitTimes[last].start <= seconds) {
      last += 1;
    }
  } else {
    first = upperBound(hitTimes, lower, (entry) => entry.start);
    last = upperBound(hitTimes, seconds, (entry) => entry.start);
  }
  if (cached && cached.hitTimes === hitTimes) {
    cached.seconds = seconds;
    cached.since = since;
    cached.lifetime = lifetime;
    cached.first = first;
    cached.last = last;
  } else {
    hitTimeCursors.set(runtime, { hitTimes, seconds, since, lifetime, first, last });
  }
  for (let index = first; index < last; index++) {
    const entry = hitTimes[index];
    if (entry.note.type !== 2 && !entry.note.isFake) {
      const slot = hits.length;
      const hit = hits[slot] ?? (hits[slot] = { entry, time: 0, seed: 0 });
      hit.entry = entry;
      hit.time = entry.start;
      hit.seed = index;
      hits.length = slot + 1;
    }
  }
  for (const { item: entry, index } of runtime.holdIndex.query(seconds - lifetime, seconds)) {
    if (entry.note.isFake) {
      continue;
    }
    const firstPulse = Math.max(
      0,
      Math.floor((Math.max(seconds - lifetime, since) - entry.start) / HOLD_HIT_INTERVAL) + 1,
    );
    const lastPulse = Math.min(
      Math.floor((seconds - entry.start) / HOLD_HIT_INTERVAL),
      Math.ceil((entry.end - entry.start) / HOLD_HIT_INTERVAL) - 1,
    );
    for (let pulse = firstPulse; pulse <= lastPulse; pulse++) {
      const slot = hits.length;
      const hit = hits[slot] ?? (hits[slot] = { entry, time: 0, seed: 0 });
      hit.entry = entry;
      hit.time = entry.start + pulse * HOLD_HIT_INTERVAL;
      hit.seed = index * 65537 + pulse;
      hits.length = slot + 1;
    }
  }
  return hits.length;
}

/** Allocates a hit buffer for the hits inside `lifetime`; see `recentHitsInto`. */
export function recentHits(
  runtime: HitRuntime,
  seconds: number,
  since: number,
  lifetime = 2 / 3,
): Hit[] {
  const hits: Hit[] = [];
  recentHitsInto(runtime, seconds, since, hits, lifetime);
  return hits;
}
