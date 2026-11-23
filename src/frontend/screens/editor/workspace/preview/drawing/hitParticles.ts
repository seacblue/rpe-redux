/**
 * Phira's four-square hit burst.
 *
 * `prpr` emits four squares from the hit point: each starts with a random
 * direction, a slightly reduced speed, and a slightly reduced size, then decays
 * against a linear acceleration of 6 and fades over the skin's hit-effect
 * lifetime. Geometry only: no canvas, no DOM; `previewHitEffects` owns drawing.
 */
import { HIT_FX_DURATION_DEFAULT } from "../../../canvas/hitFrame.ts";
import { PHIRA_NOTE_WIDTH_RATIO } from "../scene/constants.ts";

/** Phira's default hit-effect lifetime in seconds. */
export const HIT_PARTICLE_LIFETIME = HIT_FX_DURATION_DEFAULT;

/** Squares released by one hit. */
export const HIT_PARTICLE_COUNT = 4;

/** Square side per full note width; Phira uses `hitFxScale * noteScale / 44`. */
const SQUARE_SIZE_RATIO = 1 / 44 / PHIRA_NOTE_WIDTH_RATIO;
/** Initial speed per full note width per second; Phira uses `2.5 * noteScale`. */
const SQUARE_SPEED_RATIO = 2.5 / (2 * PHIRA_NOTE_WIDTH_RATIO);
/** Phira's linear deceleration applied to the square velocity. */
const LINEAR_DECELERATION = 6;
const SPEED_RANDOMNESS = 0.1;
const SIZE_RANDOMNESS = 0.3;

/** One square of the burst: a screen-pixel offset from the hit point and half a side. */
export interface HitParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/**
 * Phira's particle alpha curve: full, 70% at the midpoint, transparent at the end.
 *
 * @param progress Normalized lifetime in `[0, 1]`.
 */
export function hitParticleAlpha(progress: number): number {
  if (progress <= 0) {
    return 1;
  }
  if (progress >= 1) {
    return 0;
  }
  return progress < 0.5 ? 1 - 0.3 * (progress / 0.5) : 0.7 * (1 - (progress - 0.5) / 0.5);
}

/**
 * Fill a caller-owned four-particle buffer without allocating a new array.
 *
 * `noteWidth` is the on-screen note width in pixels. `sizeScale` folds the
 * skin's `hitFxScale` and the editor's hit-effect setting; `travelScale` only
 * folds the editor setting because Phira's `hitFxScale` affects size alone.
 *
 * @returns the number of particles written, or zero outside the lifetime.
 */
export function hitParticlesInto(
  age: number,
  lifetime: number,
  seed: number,
  noteWidth: number,
  sizeScale: number,
  travelScale: number,
  particles: HitParticle[],
): number {
  if (age < 0 || age >= lifetime || lifetime <= 0 || noteWidth <= 0) {
    return 0;
  }
  const progress = age / lifetime;
  const alpha = hitParticleAlpha(progress);
  const speed = noteWidth * SQUARE_SPEED_RATIO * travelScale;
  const distance = (speed * (1 - Math.exp(-LINEAR_DECELERATION * age))) / LINEAR_DECELERATION;
  const baseSize = noteWidth * SQUARE_SIZE_RATIO * sizeScale;
  for (let index = 0; index < HIT_PARTICLE_COUNT; index++) {
    const angle = seededFraction(seed, index) * Math.PI * 2;
    const velocity = 1 - SPEED_RANDOMNESS * seededFraction(seed, index + 101);
    const size = baseSize * (1 - SIZE_RANDOMNESS * seededFraction(seed, index + 211));
    const particle = particles[index] ?? (particles[index] = { x: 0, y: 0, radius: 0, alpha: 0 });
    particle.x = Math.cos(angle) * distance * velocity;
    particle.y = Math.sin(angle) * distance * velocity;
    particle.radius = size / 2;
    particle.alpha = alpha;
  }
  return HIT_PARTICLE_COUNT;
}

/**
 * Deterministic value in `[0, 1)` from a seed and a salt.
 *
 * The hash spreads small integer seeds (a note index, a line index) across the
 * unit range and returns the same value for the same inputs, so bursts render
 * identically across frames.
 */
function seededFraction(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The burst of a hit that happened `age` seconds ago.
 *
 * `seed` identifies the hit; the caller mixes the line and note indices into it.
 * Widths and scales are screen-pixel values; see `hitParticlesInto`.
 */
export function hitParticles(
  age: number,
  lifetime: number,
  seed: number,
  noteWidth: number,
  sizeScale: number,
  travelScale: number,
): HitParticle[] {
  const particles: HitParticle[] = [];
  const count = hitParticlesInto(age, lifetime, seed, noteWidth, sizeScale, travelScale, particles);
  particles.length = count;
  return particles;
}
