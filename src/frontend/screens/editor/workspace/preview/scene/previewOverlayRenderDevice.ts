/** Executes preview game UI and guide overlay packets on a prepared Canvas2D target. */
import { prepareCanvas } from "../../../canvas/canvas2d.ts";
import { drawGameUi } from "../render/gameUi.ts";
import { drawGuides, type PreviewGuideSurface } from "../drawing/previewGuides.ts";
import type { PreviewFrame } from "./previewTypes.ts";

/** The preview surface fields needed by the overlay device. */
export interface PreviewOverlaySurface extends PreviewGuideSurface {
  readonly completionTimes: number[];
  readonly duration?: number | null;
  readonly gameUiCornerCompression?: boolean;
  readonly showGameUI?: boolean;
}

/** One overlay submission, optionally clipped to the preview viewport. */
export interface PreviewOverlayRenderPacket {
  readonly surface: PreviewOverlaySurface;
  readonly frame: PreviewFrame;
  readonly target: CanvasRenderingContext2D;
  readonly clip?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Owns direct Canvas2D overlay calls for the main preview composite. */
export class PreviewOverlayRenderDevice {
  /** Draw the selected overlay packet onto an already prepared context. */
  render(packet: PreviewOverlayRenderPacket): void {
    const { surface, frame, target } = packet;
    target.save();
    if (packet.clip) {
      target.beginPath();
      target.rect(packet.clip.left, packet.clip.top, packet.clip.width, packet.clip.height);
      target.clip();
    }
    if (surface.showGameUI) {
      const { chart, states, seconds, selectedLine, scale, screenScale, viewport } = frame;
      drawGameUi(
        target,
        chart,
        states,
        surface.completionTimes,
        seconds,
        selectedLine,
        viewport,
        screenScale,
        surface.skin ?? null,
        surface.duration ?? 600,
        surface.gameUiCornerCompression,
      );
      drawGuides(surface, target, scale, selectedLine);
    } else {
      drawGuides(surface, target, frame.scale, frame.selectedLine);
    }
    target.restore();
  }

  /** Prepare an overlay canvas and submit one complete overlay frame. */
  renderCanvas(
    surface: PreviewOverlaySurface,
    frame: PreviewFrame,
    canvas: HTMLCanvasElement,
  ): void {
    this.render({ surface, frame, target: prepareCanvas(canvas).context });
  }
}
