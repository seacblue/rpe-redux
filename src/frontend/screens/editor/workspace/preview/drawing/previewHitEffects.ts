/**
 * Draws hit animation frames and the four-square burst at recent note hits.
 * Hit timing and particle state come from the sibling `hitEffects` and
 * `hitParticles` readers; this module owns only the canvas pass.
 */
import { recentHitsInto, type Hit } from "./hitEffects.ts";
import { hitParticlesInto, type HitParticle } from "./hitParticles.ts";
import {
  HIT_DURATION,
  HIT_FRAME_COUNT,
  HIT_FRAME_SECONDS,
  hitFrame,
  previewNoteWidth,
} from "../scene/constants.ts";
import type { PreviewFrame, PreviewSkin } from "../scene/previewTypes.ts";
import type { SampledLineState } from "../../../../../../core/global/chart/runtime/scene.ts";

type SampleAt = (index: number) => SampledLineState;

/** Skin and timing state required by hit effects. */
export interface PreviewHitEffectSurface {
  skin?: PreviewSkin | null;
  noteSize: number;
  hitEffectScale: number;
  effectsSince: number;
  defaultParticleColor: readonly number[];
  hitStateCache?: Map<number, SampleAt>;
}

/** Resolve a chart tint, keeping the configured colour only as a fallback. */
export function resolveParticleColor(
  tint: unknown,
  defaultParticleColor: readonly number[],
): readonly number[] {
  return Array.isArray(tint) ? tint : defaultParticleColor;
}

/** Draws the skin-owned hit frame and the four-square burst at each recent note hit. */
export function drawHitEffects(
  surface: PreviewHitEffectSurface,
  frame: PreviewFrame,
  maxEffects = Number.POSITIVE_INFINITY,
): void {
  if (!Number.isFinite(surface.effectsSince)) {
    return;
  }
  const { context, order, seconds, width, height, centerX, centerY, scaleX, scaleY } = frame;
  const originX = centerX ?? width / 2;
  const originY = centerY ?? height / 2;
  const hitStates = surface.hitStateCache ?? new Map<number, SampleAt>();
  const hits: Hit[] = [];
  const particles: HitParticle[] = [];
  const limit = Number.isFinite(maxEffects) ? Math.max(0, Math.floor(maxEffects)) : Infinity;
  let drawnEffects = 0;
  for (const index of order) {
    if (drawnEffects >= limit) {
      break;
    }
    const runtime = frame.scene.lines[index];
    if (!runtime) {
      continue;
    }
    const particleFrameCount = surface.skin?.particleFrameCount ?? HIT_FRAME_COUNT;
    const particleDuration = particleFrameCount * HIT_FRAME_SECONDS;
    const hitCount = recentHitsInto(
      runtime,
      seconds,
      surface.effectsSince,
      hits,
      Math.max(particleDuration || HIT_DURATION, 2 / 3),
    );
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      if (drawnEffects >= limit) {
        break;
      }
      const hit = hits[hitIndex];
      drawnEffects += 1;
      const { entry, time } = hit;
      const effectFrame = hitFrame(seconds - time, particleFrameCount);
      // An explicit chart tint wins; otherwise the user-configured default applies.
      const hitColor = resolveParticleColor(
        entry.note.tintHitEffects,
        surface.defaultParticleColor,
      );
      const picture =
        effectFrame === null ? null : surface.skin?.tinted(`img-${effectFrame}`, hitColor);
      let sampleAt = hitStates.get(time);
      if (!sampleAt) {
        // Event tracks retain the preceding event at the exact boundary. The
        // smallest practical forward step selects events starting at the hit without
        // advancing the note or visibly moving continuously animated lines.
        const afterHit = time + Math.max(Number.MIN_VALUE, Math.abs(time) * Number.EPSILON);
        sampleAt = frame.scene.sampler(afterHit);
        hitStates.set(time, sampleAt);
      }
      const state = sampleAt(index);
      const position = runtime.noteState(entry, state, time);
      const angle = (state.rotation * Math.PI) / 180;
      const horizontal =
        originX + (state.x + position.x * Math.cos(angle) + position.y * Math.sin(angle)) * scaleX;
      const vertical =
        originY + (-state.y + position.x * Math.sin(angle) - position.y * Math.cos(angle)) * scaleY;
      // The skin supplies its own animation; the burst stays correct without one.
      if (picture && effectFrame !== null) {
        const size = previewNoteWidth(surface.noteSize) * surface.hitEffectScale * 1.4 * scaleX;
        context.globalAlpha = Math.max(0, Math.min(1, hitColor[3] ?? 1));
        context.drawImage(picture, horizontal - size / 2, vertical - size / 2, size, size);
      }
      context.fillStyle = `rgb(${Math.min(255, Math.max(0, Math.round(hitColor[0] ?? 0)))},${Math.min(255, Math.max(0, Math.round(hitColor[1] ?? 0)))},${Math.min(255, Math.max(0, Math.round(hitColor[2] ?? 0)))})`;
      const particleCount = hitParticlesInto(
        seconds - time,
        index * 65537 + hit.seed,
        previewNoteWidth(surface.noteSize) * surface.hitEffectScale * scaleX,
        width * surface.hitEffectScale,
        particles,
      );
      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        const particle = particles[particleIndex];
        context.globalAlpha = particle.alpha * Math.max(0, Math.min(1, hitColor[3] ?? 1));
        context.fillRect(
          horizontal + particle.x - particle.radius,
          vertical + particle.y - particle.radius,
          particle.radius * 2,
          particle.radius * 2,
        );
      }
      // Do not leak burst transparency into later draw passes.
      context.globalAlpha = 1;
    }
  }
  if (surface.hitStateCache) {
    const oldestActiveHit = seconds - Math.max(HIT_DURATION, 2 / 3);
    for (const time of surface.hitStateCache.keys()) {
      if (time < oldestActiveHit) {
        surface.hitStateCache.delete(time);
      }
    }
  }
}
