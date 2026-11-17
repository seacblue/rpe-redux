/** Executes preview game UI and guide overlay packets on a prepared Canvas2D target. */
import { prepareCanvas } from "../../../canvas/canvas2d.ts";
import { drawGameUi } from "../render/gameUi.ts";
import {
  buildGuidePacket,
  drawGuides,
  type GuideDrawStats,
  type PreviewGuideSurface,
} from "../drawing/previewGuides.ts";
import type { PreviewGuideBatch } from "../render/previewGuideBatch.ts";
import type { PreviewFrame } from "./previewTypes.ts";

/** The preview surface fields needed by the overlay device. */
export interface PreviewOverlaySurface extends PreviewGuideSurface {
  readonly completionTimes: number[];
  readonly duration?: number | null;
  readonly gameUiCornerCompression?: boolean;
  readonly showGameUI?: boolean;
  readonly guideBatch?: PreviewGuideBatch | null;
  /** WebGL guide batches are valid only when the target is their shader canvas. */
  readonly shaderCanvas?: HTMLCanvasElement | null;
}

/** One overlay submission, optionally clipped to the preview viewport. */
export interface PreviewOverlayRenderPacket {
  readonly surface: PreviewOverlaySurface;
  readonly frame: PreviewFrame;
  readonly target: CanvasRenderingContext2D;
  /** Whether this submission owns the game UI layer as well as guides. */
  readonly drawGameUI?: boolean;
  readonly clip?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Owns direct Canvas2D overlay calls for the main preview composite. */
export class PreviewOverlayRenderDevice {
  /** Submit guides to the shared WebGL atlas when the frame can use that path. */
  private drawGuideLayer(
    surface: PreviewOverlaySurface,
    target: CanvasRenderingContext2D,
    frame: PreviewFrame,
    scale: number,
    selectedLine: number,
    clip?: PreviewOverlayRenderPacket["clip"],
  ): GuideDrawStats {
    const started = performance.now();
    const canUseBatch =
      surface.guideBatch &&
      surface.shaderCanvas === target.canvas &&
      !frame.shaderEffects.some((effect) => effect.global === true);
    if (canUseBatch) {
      const packet = buildGuidePacket(surface, target, scale, selectedLine);
      const ready = packet.glyphs.every((glyph) => glyph.atlasGlyph !== null);
      if (ready) {
        const submitted = surface.guideBatch.render(packet, frame.width, frame.height, clip);
        if (submitted) {
          return {
            ...submitted,
            durationMs: performance.now() - started,
          };
        }
      }
    }
    return drawGuides(surface, target, scale, selectedLine);
  }

  /** Draw the selected overlay packet onto an already prepared context. */
  render(packet: PreviewOverlayRenderPacket): GuideDrawStats {
    const { surface, frame, target } = packet;
    target.save();
    if (packet.clip) {
      target.beginPath();
      target.rect(packet.clip.left, packet.clip.top, packet.clip.width, packet.clip.height);
      target.clip();
    }
    let guideStats: GuideDrawStats;
    if (surface.showGameUI && packet.drawGameUI !== false) {
      const { chart, states, seconds, selectedLine, centerX, centerY, scale, viewport } = frame;
      drawGameUi(
        target,
        chart,
        states,
        surface.completionTimes,
        seconds,
        selectedLine,
        viewport,
        {
          centerX,
          centerY,
          scale,
        },
        surface.skin ?? null,
        surface.duration ?? 600,
        surface.gameUiCornerCompression,
      );
      guideStats = this.drawGuideLayer(
        surface,
        target,
        frame,
        frame.scale,
        selectedLine,
        packet.clip,
      );
    } else {
      guideStats = this.drawGuideLayer(
        surface,
        target,
        frame,
        frame.scale,
        frame.selectedLine,
        packet.clip,
      );
    }
    target.restore();
    return guideStats;
  }

  /** Prepare an overlay canvas and submit one complete overlay frame. */
  renderCanvas(
    surface: PreviewOverlaySurface,
    frame: PreviewFrame,
    canvas: HTMLCanvasElement,
  ): GuideDrawStats {
    return this.render({ surface, frame, target: prepareCanvas(canvas).context });
  }
}
