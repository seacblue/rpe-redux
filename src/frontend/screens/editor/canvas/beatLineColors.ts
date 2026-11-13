/**
 * Beat-line color roles shared by every canvas adapter.
 *
 * A division is decomposed from coarse to fine, so a finer role never repaints a
 * line an earlier role already claimed; divisions outside the supported
 * denominators fall back to `default` rather than inventing a color. Each
 * pattern is exactly one beat long: division 4 has four roles, division 8 has
 * eight, and the preview and the timeline index the same array.
 */
/** Color role names in coarse-to-fine order. */
export const BEAT_LINE_COLOR_KEYS = ["1", "2", "3", "4", "6", "8", "12", "16", "default"] as const;

/** The role of one line in a beat-color pattern. */
export type BeatLineColorKey = (typeof BEAT_LINE_COLOR_KEYS)[number];

const PREVIEW_PATTERNS: Readonly<Record<number, readonly BeatLineColorKey[]>> = {
  4: ["1", "4", "2", "4"],
  8: ["1", "8", "4", "8", "2", "8", "4", "8"],
  12: ["1", "12", "6", "4", "3", "12", "2", "12", "3", "4", "6", "12"],
};

const SUPPORTED_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16] as const;

/** Avoid rebuilding ordinary subdivision patterns for every painted grid line. */
const GENERATED_PATTERN_CACHE_LIMIT = 128;
const generatedPatternCache = new Map<number, readonly BeatLineColorKey[]>();

/** Assign colors from coarse to fine without overwriting an assigned line. */
export function beatLineColorKeys(lineCount: number): readonly BeatLineColorKey[] {
  const count = Math.max(1, Math.trunc(lineCount));
  const previewPattern = PREVIEW_PATTERNS[count];
  if (previewPattern) {
    return previewPattern;
  }
  const cached = generatedPatternCache.get(count);
  if (cached) {
    return cached;
  }

  const roles: BeatLineColorKey[] = Array.from({ length: count }, () => "default");
  for (const denominator of SUPPORTED_DENOMINATORS) {
    if (count % denominator !== 0) {
      continue;
    }
    const stride = count / denominator;
    const role = String(denominator) as BeatLineColorKey;
    for (let index = 0; index < count; index += 1) {
      if (index % stride === 0 && roles[index] === "default") {
        roles[index] = role;
      }
    }
  }
  if (count <= GENERATED_PATTERN_CACHE_LIMIT) {
    generatedPatternCache.set(count, roles);
  }
  return roles;
}

/** The role of the line at `tick` for a one-beat pattern of `division` lines. */
export function beatLineColorKeyAt(tick: number, division: number): BeatLineColorKey {
  const count = Math.max(1, Math.trunc(division));
  const roles = beatLineColorKeys(count);
  const index = ((Math.trunc(tick) % count) + count) % count;
  return roles[index] ?? "default";
}

/** Letter labels for one beat's color pattern; unknowns render as `?`. */
export function beatLinePatternLabel(division: number): string {
  return beatLineColorKeys(division)
    .map((key) =>
      key === "default" ? "?" : String.fromCharCode(64 + BEAT_LINE_COLOR_KEYS.indexOf(key) + 1),
    )
    .join("");
}
