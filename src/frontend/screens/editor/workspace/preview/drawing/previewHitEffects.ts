/**
 * Draws the skin's hit animation and Phira's four-square burst at recent hits.
 * Hit timing and particle state come from the sibling `hitEffects` and
 * `hitParticles` readers; this module owns only the canvas pass.
 */
import { noteIsAbove } from "../../../../../../core/global/chart/chart.ts";
import { HIT_FX_DURATION_DEFAULT, HIT_FRAME_COUNT, hitFrame } from "../../../canvas/hitFrame.ts";
import { PHIRA_HIT_FX_WIDTH_RATIO, previewNoteWidth } from "../scene/constants.ts";
import type { PreviewFrame, PreviewSkin } from "../scene/previewTypes.ts";
import type { SampledLineState } from "../../../../../../core/global/chart/runtime/scene.ts";
import { recentHitsInto, type Hit } from "./hitEffects.ts";
import { hitParticleAlpha, hitParticlesInto, type HitParticle } from "./hitParticles.ts";

type SampleAt = (index: number) => SampledLineState;

/** One resolved hit colour: its CSS form and its channels. */
interface ResolvedHitColor {
  readonly source: readonly number[];
  readonly css: string;
  readonly alpha: number;
}

/** Phira's untinted hit-effect colour. */
const UNTINTED_HIT_COLOR = [255, 255, 255] as const;

/** Resolve a hit colour array to CSS and channels once per distinct array. */
function resolveHitColor(
  color: readonly number[],
  cache: WeakMap<object, ResolvedHitColor>,
): ResolvedHitColor {
  const cached = cache.get(color);
  if (cached) {
    return cached;
  }
  const red = Math.min(255, Math.max(0, Math.round(color[0] ?? 0)));
  const green = Math.min(255, Math.max(0, Math.round(color[1] ?? 0)));
  const blue = Math.min(255, Math.max(0, Math.round(color[2] ?? 0)));
  const resolved: ResolvedHitColor = {
    source: color,
    css: `rgb(${red},${green},${blue})`,
    alpha: Math.max(0, Math.min(1, color[3] ?? 1)),
  };
  cache.set(color, resolved);
  return resolved;
}

/** Cached hit colours; skin tints reuse the same arrays frame after frame. */
const hitColorCache = new WeakMap<object, ResolvedHitColor>();

/** Skin and timing state required by hit effects. */
export interface PreviewHitEffectSurface {
  skin?: PreviewSkin | null;
  noteSize: number;
  hitEffectScale: number;
  effectsSince: number;
  /** True when the authoring timeline shares the stage with the preview. */
  authoringRegionVisible?: boolean;
  defaultParticleColor: readonly number[];
  hitStateCache?: Map<number, SampleAt>;
}

interface HitEffectScratch {
  hits: Hit[];
  particles: HitParticle[];
  hitStates: Map<number, SampleAt>;
}

const hitEffectScratch = new WeakMap<object, HitEffectScratch>();

/** Return the per-surface buffers reused by the hit-effect pass. */
function scratchFor(surface: object): HitEffectScratch {
  const cached = hitEffectScratch.get(surface);
  if (cached) {
    return cached;
  }
  const scratch: HitEffectScratch = {
    hits: [],
    particles: [],
    hitStates: new Map(),
  };
  hitEffectScratch.set(surface, scratch);
  return scratch;
}

/** Phira's hit-effect colour: an explicit note tint wins over the skin policy. */
function hitEffectColor(
  tint: unknown,
  defaultParticleColor: readonly number[],
  tinted: boolean,
): readonly number[] {
  if (Array.isArray(tint)) {
    return tint;
  }
  return tinted ? defaultParticleColor : UNTINTED_HIT_COLOR;
}

/** Draws the skin-owned hit frame and the four-square burst at each recent note hit. */
export function drawHitEffects(surface: PreviewHitEffectSurface, frame: PreviewFrame): void {
  if (surface.authoringRegionVisible || !Number.isFinite(surface.effectsSince)) {
    return;
  }
  const { context, order, seconds, width, height, centerX, centerY, scaleX, scaleY } = frame;
  const originX = centerX ?? width / 2;
  const originY = centerY ?? height / 2;
  const scratch = scratchFor(surface);
  const hitStates = surface.hitStateCache ?? scratch.hitStates;
  if (!surface.hitStateCache) {
    // Optional test/minimal surfaces do not promise sampler stability across frames.
    hitStates.clear();
  }
  const { hits, particles } = scratch;
  const frameCount = surface.skin?.particleFrameCount ?? HIT_FRAME_COUNT;
  const duration = Math.max(1e-6, surface.skin?.hitFxDuration ?? HIT_FX_DURATION_DEFAULT);
  const lifetime = Math.max(duration, 1e-6);
  for (const index of order) {
    const runtime = frame.scene.lines[index];
    if (!runtime) {
      continue;
    }
    const hitCount = recentHitsInto(runtime, seconds, surface.effectsSince, hits, lifetime);
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      const hit = hits[hitIndex];
      const { entry, time } = hit;
      const age = seconds - time;
      const effectFrame = hitFrame(age, frameCount, duration);
      // An explicit chart tint wins; otherwise the skin policy decides between
      // the user's particle colour and Phira's untinted white.
      const hitColor = resolveHitColor(
        hitEffectColor(
          entry.note.tintHitEffects,
          surface.defaultParticleColor,
          surface.skin?.hitFxTinted !== false,
        ),
        hitColorCache,
      );
      const picture =
        effectFrame === null
          ? null
          : surface.skin?.tinted(`img-${effectFrame}`, hitColor.source as number[]);
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
      const noteWidth = previewNoteWidth(surface.noteSize) * scaleX;
      const sizeScale = (surface.skin?.hitFxScale ?? 1) * surface.hitEffectScale;
      const fade = hitParticleAlpha(age / duration);
      // The skin supplies its own animation; the burst stays correct without one.
      if (picture && effectFrame !== null) {
        const size = noteWidth * PHIRA_HIT_FX_WIDTH_RATIO * sizeScale;
        context.globalAlpha = hitColor.alpha * fade;
        if (surface.skin?.hitFxRotate) {
          context.save();
          context.translate(horizontal, vertical);
          context.rotate(angle + (noteIsAbove(entry.note) ? 0 : Math.PI));
          context.drawImage(picture, -size / 2, -size / 2, size, size);
          context.restore();
        } else {
          context.drawImage(picture, horizontal - size / 2, vertical - size / 2, size, size);
        }
      }
      if (surface.skin?.hideParticles === true) {
        continue;
      }
      context.fillStyle = hitColor.css;
      const particleCount = hitParticlesInto(
        age,
        duration,
        index * 65537 + hit.seed,
        noteWidth,
        sizeScale,
        surface.hitEffectScale,
        particles,
      );
      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        const particle = particles[particleIndex];
        context.globalAlpha = particle.alpha * hitColor.alpha;
        context.fillRect(
          horizontal + particle.x - particle.radius,
          vertical + particle.y - particle.radius,
          particle.radius * 2,
          particle.radius * 2,
        );
      }
    }
  }
  // Do not leak burst transparency into later draw passes.
  context.globalAlpha = 1;
  const oldestActiveHit = seconds - lifetime;
  for (const time of hitStates.keys()) {
    if (time < oldestActiveHit) {
      hitStates.delete(time);
    }
  }
}
