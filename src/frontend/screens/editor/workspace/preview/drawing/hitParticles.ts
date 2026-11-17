/**
 * Four-square hit burst adapted from RPE Recorder's particle pass.
 *
 * Recorder settings `low_sq`, `high_sq`, `sq_size`, and `sq_time` define the
 * burst: four squares pick a random direction, start with a small random radial
 * offset, travel outward with a quadratic ease-out, and fade linearly while the
 * size follows Recorder's two-phase curve. This module keeps that structure and
 * applies three preview-only tweaks: 12% shorter travel, ±8% square-size
 * jitter, and a 520 ms lifetime instead of 500 ms.
 *
 * Geometry only: no canvas, no DOM. `previewHitEffects` owns the drawing.
 */

/** How long a burst stays on screen, in seconds. */
export const HIT_PARTICLE_LIFETIME = 0.52;

/** Squares released by one hit. */
export const HIT_PARTICLE_COUNT = 4;

/** Recorder normalizes its square-speed range by 4/9 before scaling to width. */
const RECORDER_SPEED_NORMALIZER = 4 / 9;
const RECORDER_LOW_SQ = 0.2 * RECORDER_SPEED_NORMALIZER;
const RECORDER_HIGH_SQ = 0.25 * RECORDER_SPEED_NORMALIZER;
const RECORDER_SQ_SIZE = 0.175;

/** Preview-only tuning applied on top of the Recorder values. */
const PREVIEW_TRAVEL_SCALE = 0.88;
const PREVIEW_SIZE_JITTER = 0.08;

/** One square of the burst: a screen-pixel offset from the hit point and half a side. */
export interface HitParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/**
 * Fill a caller-owned four-particle buffer without allocating a new array.
 *
 * `noteWidth` is the on-screen note width in pixels and drives square size;
 * `burstWidth` is the width the burst expands across: the projected chart-frame
 * width times the skin's hit-effect scale. Both are pixels, so the result is
 * resolution-independent.
 *
 * @returns the number of particles written, or zero outside the lifetime.
 */
export function hitParticlesInto(
  age: number,
  seed: number,
  noteWidth: number,
  burstWidth: number,
  particles: HitParticle[],
): number {
  if (age < 0 || age >= HIT_PARTICLE_LIFETIME || noteWidth <= 0 || burstWidth <= 0) {
    return 0;
  }
  const progress = age / HIT_PARTICLE_LIFETIME;
  const travel = 1 - (1 - progress) ** 2;
  const alpha = 1 - progress;
  const sizeCurve =
    progress < 2 / 3
      ? 0.5 + 0.5 * (1 - (1 - progress * 1.5) ** 2)
      : 0.7 + 0.3 * (1 - (1 - (1 - progress) * 3) ** 2);
  const baseTravel = burstWidth * RECORDER_LOW_SQ * PREVIEW_TRAVEL_SCALE;
  const randomTravel = burstWidth * (RECORDER_HIGH_SQ - RECORDER_LOW_SQ) * PREVIEW_TRAVEL_SCALE;
  const baseRadius = noteWidth * RECORDER_SQ_SIZE * 0.5;
  for (let index = 0; index < HIT_PARTICLE_COUNT; index++) {
    const angle = seededFraction(seed, index) * Math.PI * 2;
    const offset = randomTravel * seededFraction(seed, index + 101);
    const distance = offset + baseTravel * travel;
    const jitter =
      1 - PREVIEW_SIZE_JITTER + seededFraction(seed, index + 211) * PREVIEW_SIZE_JITTER * 2;
    const particle = particles[index] ?? (particles[index] = { x: 0, y: 0, radius: 0, alpha: 0 });
    particle.x = Math.cos(angle) * distance;
    particle.y = Math.sin(angle) * distance;
    particle.radius = baseRadius * sizeCurve * jitter;
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
 * `noteWidth` and `burstWidth` are screen-pixel widths; see `hitParticlesInto`.
 */
export function hitParticles(
  age: number,
  seed: number,
  noteWidth: number,
  burstWidth: number,
): HitParticle[] {
  const particles: HitParticle[] = [];
  const count = hitParticlesInto(age, seed, noteWidth, burstWidth, particles);
  particles.length = count;
  return particles;
}
