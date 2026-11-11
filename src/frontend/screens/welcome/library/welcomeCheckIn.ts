/**
 * Local-day check-in state for the home library's welcome panel.
 *
 * This is a playful surface, not an account feature. The browser remembers the
 * last local day the user checked in; the fortune and the welcome title are
 * picked deterministically from that day's seed so a reload shows the same
 * result.
 */
const CHECK_IN_KEY = "rpe-redux.library.check-in";

/** The local calendar day as `YYYY-MM-DD`. */
export function localDay(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The last day the user checked in, or null when storage is unavailable. */
export function readCheckInDay(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(CHECK_IN_KEY);
  } catch {
    return null;
  }
}

/** Records today's check-in. Storage failures leave the session-only state intact. */
export function writeCheckInDay(day: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CHECK_IN_KEY, day);
  } catch {
    // The panel still shows the result for this session.
  }
}

/** FNV-1a hash of a string as an unsigned 32-bit integer. */
function hashDay(day: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < day.length; index += 1) {
    hash ^= day.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Stable index into a daily list (fortune ranks, title pools, and so on). */
export function fortuneIndexForDay(day: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  // Hashing the date keeps the result stable across reloads and languages.
  return hashDay(day) % count;
}

/**
 * Stable, distinct pool indices for one local day.
 *
 * `salt` separates independent draws such as suitable, avoid, and food. A
 * deterministic shuffle gives every draw the same order while keeping the
 * returned indices distinct.
 */
export function dailyFortunePicks(
  day: string,
  count: number,
  poolSize: number,
  salt: string,
): number[] {
  if (count <= 0 || poolSize <= 0) {
    return [];
  }
  const pool = Array.from({ length: poolSize }, (_, index) => index);
  // A linear congruential generator is enough for a daily fortune; the seed
  // makes the shuffle repeatable for the same day and salt.
  let state = hashDay(`${salt}:${day}`) || 1;
  for (let index = pool.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const current = pool[index];
    pool[index] = pool[swap];
    pool[swap] = current;
  }
  return pool.slice(0, Math.min(count, poolSize));
}
