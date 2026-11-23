/** Verifies Phira's four-square hit particle geometry and lifetime. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HIT_PARTICLE_LIFETIME,
  hitParticleAlpha,
  hitParticles,
} from "../../../frontend/screens/editor/workspace/preview/drawing/hitParticles.ts";
import { PHIRA_NOTE_WIDTH_RATIO } from "../../../frontend/screens/editor/workspace/preview/scene/constants.ts";

test("the burst is deterministic and bounded by its lifetime", () => {
  const first = hitParticles(0.13, HIT_PARTICLE_LIFETIME, 42, 175, 1, 1);
  const second = hitParticles(0.13, HIT_PARTICLE_LIFETIME, 42, 175, 1, 1);
  assert.equal(first.length, 4);
  assert.deepEqual(first, second);
  assert.equal(hitParticles(HIT_PARTICLE_LIFETIME, HIT_PARTICLE_LIFETIME, 42, 175, 1, 1).length, 0);
  assert.equal(hitParticles(-0.01, HIT_PARTICLE_LIFETIME, 42, 175, 1, 1).length, 0);
});

test("Phira's alpha curve peaks at the hit, holds 70% at half life, and ends at zero", () => {
  assert.equal(hitParticleAlpha(0), 1);
  assert.ok(Math.abs(hitParticleAlpha(0.5) - 0.7) < 1e-9);
  assert.equal(hitParticleAlpha(1), 0);
});

test("travel scales with the note width and stays inside Phira's envelope", () => {
  const age = HIT_PARTICLE_LIFETIME - 1e-6;
  const distance = (particles) =>
    Math.max(...particles.map((particle) => Math.hypot(particle.x, particle.y)));
  const small = distance(hitParticles(age, HIT_PARTICLE_LIFETIME, 7, 100, 1, 1));
  const large = distance(hitParticles(age, HIT_PARTICLE_LIFETIME, 7, 200, 1, 1));
  assert.ok(large > small * 1.9);
  // 2.5 note-widths/s decaying at 6/s over 0.5s stays under two note widths.
  assert.ok(large < 200 * 2);
});

test("square size follows the note width and Phira's size randomness", () => {
  const progress = 0.5;
  const particles = hitParticles(
    progress * HIT_PARTICLE_LIFETIME,
    HIT_PARTICLE_LIFETIME,
    11,
    200,
    1,
    1,
  );
  const baseSide = 200 * (1 / 44 / PHIRA_NOTE_WIDTH_RATIO);
  for (const particle of particles) {
    assert.ok(particle.radius >= baseSide * 0.69 * 0.5);
    assert.ok(particle.radius <= baseSide * 1.01 * 0.5);
    assert.ok(Math.abs(particle.alpha - 0.7) < 1e-9);
  }
});
