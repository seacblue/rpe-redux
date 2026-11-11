/**
 * Local-day check-in state for the home library's welcome panel.
 *
 * This is a playful surface, not an account feature. The browser remembers the
 * last local day the user checked in. The fortune is drawn from a per-install
 * seed combined with that day, so one installation keeps the same reading for a
 * whole day while two installations get different readings on the same day.
 */
const CHECK_IN_KEY = "rpe-redux.library.check-in";
const FORTUNE_SEED_KEY = "rpe-redux.library.fortune-seed";

/** Fallback seed when storage is unavailable; keeps one session deterministic. */
let sessionSeed: string | null = null;

/** Generate a seed; `crypto.randomUUID` keeps installations from colliding. */
function createSeed(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `seed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

/**
 * The per-installation fortune seed.
 *
 * Created once and persisted, so reloading the panel, switching language, or
 * opening it on the next day keeps the same identity. Without storage access the
 * seed lives for this session only.
 */
export function readFortuneSeed(): string {
  if (typeof window === "undefined") {
    sessionSeed ??= createSeed();
    return sessionSeed;
  }
  try {
    const stored = window.localStorage.getItem(FORTUNE_SEED_KEY);
    if (stored !== null && stored !== "") {
      return stored;
    }
    const created = createSeed();
    window.localStorage.setItem(FORTUNE_SEED_KEY, created);
    return created;
  } catch {
    sessionSeed ??= createSeed();
    return sessionSeed;
  }
}

/** The deterministic draw seed for one local day on this installation. */
export function dailyFortuneSeed(day: string): string {
  return `${readFortuneSeed()}:${day}`;
}

/** FNV-1a hash of a string as an unsigned 32-bit integer. */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Stable index into a daily list (the fortune rank and the daily items). */
export function fortuneIndexForSeed(seed: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  // Hashing the seed keeps the result stable across reloads and languages.
  return hashText(seed) % count;
}

/**
 * Stable, distinct pool indices for one local day.
 *
 * `salt` separates independent draws such as suitable, avoid, and food. A
 * deterministic shuffle gives every draw the same order while keeping the
 * returned indices distinct.
 */
export function dailyFortunePicks(
  seed: string,
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
  let state = hashText(`${salt}:${seed}`) || 1;
  for (let index = pool.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const current = pool[index];
    pool[index] = pool[swap];
    pool[swap] = current;
  }
  return pool.slice(0, Math.min(count, poolSize));
}
