/**
 * The three-box easing editor: id, family, and direction.
 *
 * RPE stores easing as one of 29 numbered curves, and the numbers are not a
 * formula — each family contributes an `In`, an `Out` and sometimes an `InOut`.
 * Editing that number directly is how the chart format works, so the id stays
 * the source of truth, and the two lists are a second view of the same value:
 * choosing a family or a direction rewrites the id, and typing an id selects the
 * family and direction it belongs to.
 *
 * An id outside 1..29 is refused, not clamped: clamping would silently rewrite
 * what the author typed, so the box turns invalid and the chart keeps its value.
 */

export const EASING_FAMILIES = [
  "Linear",
  "Sine",
  "Quad",
  "Cubic",
  "Quart",
  "Quint",
  "Expo",
  "Circ",
  "Back",
  "Elastic",
  "Bounce",
] as const;

export type EasingFamily = (typeof EASING_FAMILIES)[number];
export type EasingDirection = "In" | "Out" | "InOut";

interface FamilyIds {
  in?: number;
  out?: number;
  inOut?: number;
}

/** The 29 ids of the RPE easing table, grouped by family. */
const FAMILY_IDS: Record<Exclude<EasingFamily, "Linear">, FamilyIds> = {
  Sine: { out: 2, in: 3, inOut: 6 },
  Quad: { out: 4, in: 5, inOut: 7 },
  Cubic: { out: 8, in: 9, inOut: 12 },
  Quart: { out: 10, in: 11, inOut: 13 },
  Quint: { out: 14, in: 15 },
  Expo: { out: 16, in: 17 },
  Circ: { out: 18, in: 19, inOut: 22 },
  Back: { out: 20, in: 21, inOut: 23 },
  Elastic: { out: 24, in: 25, inOut: 29 },
  Bounce: { out: 26, in: 27, inOut: 28 },
};

/** The easing id range the chart format defines. */
export const EASING_MIN = 1;
/** Highest valid easing id. */
export const EASING_MAX = 29;

/** Whether `value` is one of the 29 chart easing ids. */
export function isEasingId(value: number): boolean {
  return Number.isInteger(value) && value >= EASING_MIN && value <= EASING_MAX;
}

/** The family and direction an easing id belongs to; unknown ids read as `Linear`/`Out`. */
export function easingParts(value: number): {
  family: EasingFamily;
  direction: EasingDirection;
} {
  if (!isEasingId(value) || value === 1) {
    return { family: "Linear", direction: "Out" };
  }
  for (const [family, ids] of Object.entries(FAMILY_IDS) as [
    Exclude<EasingFamily, "Linear">,
    FamilyIds,
  ][]) {
    if (ids.in === value) {
      return { family, direction: "In" };
    }
    if (ids.out === value) {
      return { family, direction: "Out" };
    }
    if (ids.inOut === value) {
      return { family, direction: "InOut" };
    }
  }
  return { family: "Linear", direction: "Out" };
}

/** The id for a family/direction pair, or `null` when that pair does not exist. */
export function easingId(family: EasingFamily, direction: EasingDirection): number | null {
  if (family === "Linear") {
    return 1;
  }
  const ids = FAMILY_IDS[family];
  const value = direction === "In" ? ids.in : direction === "Out" ? ids.out : ids.inOut;
  return value ?? null;
}

/** The directions a family defines, in `In`, `Out`, `InOut` order. */
export function easingDirections(family: EasingFamily): EasingDirection[] {
  if (family === "Linear") {
    return [];
  }
  const ids = FAMILY_IDS[family];
  return (["In", "Out", "InOut"] as const).filter((direction) =>
    direction === "In"
      ? ids.in !== undefined
      : direction === "Out"
        ? ids.out !== undefined
        : ids.inOut !== undefined,
  );
}

/** Step an easing id without leaving the chart format's valid range. */
export function stepEasingId(value: number, direction: number): number {
  const base = isEasingId(value) ? value : EASING_MIN;
  return Math.min(EASING_MAX, Math.max(EASING_MIN, base + Math.sign(direction)));
}

/** Rotate the family list, wrapping from either end back to the other. */
export function rotateEasingFamily(family: EasingFamily, direction: number): EasingFamily {
  const index = EASING_FAMILIES.indexOf(family);
  const offset = Math.sign(direction);
  const next = (index + offset + EASING_FAMILIES.length) % EASING_FAMILIES.length;
  return EASING_FAMILIES[next];
}

/** Rotate a family's available directions, or return `null` for Linear. */
export function rotateEasingDirection(
  directions: readonly EasingDirection[],
  current: EasingDirection | undefined,
  direction: number,
): EasingDirection | null {
  if (directions.length === 0) {
    return null;
  }
  const index = Math.max(0, directions.indexOf(current ?? directions[0]));
  const offset = Math.sign(direction);
  return directions[(index + offset + directions.length) % directions.length] ?? null;
}
