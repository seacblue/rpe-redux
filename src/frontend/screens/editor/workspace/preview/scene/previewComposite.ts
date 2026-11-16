/**
 * Composes one preview frame onto its canvases: background, notes, lines,
 * shader passes, and game UI, with the underlay opacity limit. Draw order and
 * region visibility belong here; individual passes own their drawing.
 */
import { ShaderRuntime } from "../../../../../../core/global/chart/shader/shader.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import type { PreviewGuideSurface } from "../drawing/previewGuides.ts";
import type { PreviewDisplayAdapter } from "../surface/previewDisplay.ts";
import type { ShaderPipeline } from "../render/shaderPipeline.ts";
import type { ShaderInputLayer } from "../render/shaderPipeline.ts";
import type { ShaderCompositeRenderDevice } from "../render/shaderCompositeRenderDevice.ts";
import type { PreviewFrame, PreviewShaderEffect } from "./previewTypes.ts";
import { PreviewOverlayRenderDevice } from "./previewOverlayRenderDevice.ts";
import type { GuideDrawStats } from "../drawing/previewGuides.ts";
import type { NoteBatch } from "../../../canvas/noteBatch.ts";
import type { PreviewGuideBatch } from "../render/previewGuideBatch.ts";

import {
  getEditorRegionSnapshot,
  showsAuthoringRegion,
} from "../../runtime/commands/viewControls.ts";

/** Canvas, shader, and display switches read by the composition stage. */
export interface PreviewCompositeSurface extends PreviewGuideSurface {
  canvas: HTMLCanvasElement;
  shaderPipeline: ShaderPipeline;
  shaderCompositeDevice: ShaderCompositeRenderDevice;
  shaderRuntime: ShaderRuntime;
  display: PreviewDisplayAdapter;
  shaderCanvas: HTMLCanvasElement | null;
  overlayCanvas: HTMLCanvasElement | null;
  applyShaders: boolean;
  noiseComposited: boolean;
  showGameUI?: boolean;
  gameUiCornerCompression?: boolean;
  opacity: number;
  forceOpaque?: boolean;
  duration?: number | null;
  completionTimes: number[];
  noteBatch: NoteBatch;
  sharedNoteBatch: boolean;
  guideBatch?: PreviewGuideBatch | null;
}

/** Draw the game UI and judge-line guides onto one preview layer. */
const overlayDevice = new PreviewOverlayRenderDevice();

/**
 * Finishes a frame: runs shader passes, draws game UI and guides, and writes
 * layer opacity.
 *
 * The canvases clip themselves to the aspect frame, so this stage never paints
 * a mask over the surrounding stage. `shaderInput` is the shared-context note
 * layer; legacy `shaderOverlay` remains only for non-shared fallback surfaces.
 */
export function drawComposite(
  surface: PreviewCompositeSurface,
  frame: PreviewFrame,
  shaderOverlay: HTMLCanvasElement | null = null,
  shaderInput: ShaderInputLayer | null = null,
): GuideDrawStats | null {
  const { context, seconds, viewport } = frame;
  let guideStats: GuideDrawStats | null = null;
  // `Preview.draw` compiles the shader runtime before sampling `frame.shaderEffects`,
  // so composite consumes that compiled state instead of re-running the check.
  // Guides are cheap and identify the selected line; never put them behind the
  // adaptive quality gate. A missing number reads as a rendering failure, while
  // a slightly slower frame is invisible. Background blur follows the same rule.
  const shaderEffects = surface.applyShaders ? frame.shaderEffects : [];
  const globalShader = shaderEffects.some((effect) => effect.global);
  if (!shaderEffects.length) {
    guideStats = overlayDevice.render({ surface, frame, target: context });
  }
  if (globalShader) {
    guideStats = overlayDevice.render({ surface, frame, target: context });
  }
  context.restore();
  let shaderRendered = false;
  if (shaderEffects.length) {
    shaderRendered = surface.shaderCompositeDevice.render({
      sourceCanvas: surface.canvas,
      targetCanvas: surface.shaderCanvas,
      passes: shaderEffects,
      seconds,
      sourceFor: (effect: PreviewShaderEffect) =>
        surface.shaderRuntime.source(effect.shader, effect.sourceName),
      viewport,
      sourceRevision: frame.shaderSourceRevision,
      overlayCanvas: shaderOverlay,
      inputLayer: shaderInput,
    });
    if (surface.shaderCanvas) {
      surface.display.setShaderVisible(shaderRendered);
    }
    if (!shaderRendered && shaderInput) {
      surface.noteBatch.finish();
    }
  } else if (surface.shaderCanvas) {
    surface.display.setShaderVisible(false);
  }
  // The opacity setting describes a preview covered by authoring regions. When
  // the preview is the only visible region, show it fully opaque so its colors
  // are not washed out by the transparency meant for an underlay.
  const workspaceOpacity =
    surface.forceOpaque ||
    (surface.display.kind === "workspace-underlay" &&
      !showsAuthoringRegion(getEditorRegionSnapshot()))
      ? 1
      : clamp01(surface.opacity);
  // The shader canvas replaces the primary underlay while it is visible, so it
  // must receive the same timeline-underlay dimming as the primary canvas.
  surface.display.setShaderOpacity(shaderRendered ? workspaceOpacity : 0);
  surface.display.setPrimaryOpacity(shaderRendered ? 0 : workspaceOpacity);
  surface.display.setNoteBatchOpacity(
    surface.sharedNoteBatch || shaderRendered || surface.noiseComposited ? 0 : workspaceOpacity,
  );
  if (surface.sharedNoteBatch) {
    const noteLayerVisible = !shaderRendered && surface.noteBatch.isActive();
    surface.display.setShaderVisible(shaderRendered || noteLayerVisible);
    surface.display.setShaderOpacity(shaderRendered || noteLayerVisible ? workspaceOpacity : 0);
  }
  surface.display.setOverlayOpacity(workspaceOpacity);
  if (!shaderRendered && shaderEffects.length && !globalShader) {
    guideStats = overlayDevice.render({
      surface,
      frame,
      target: context,
      clip: viewport,
    });
  }
  if (shaderRendered && !globalShader && surface.overlayCanvas) {
    guideStats = overlayDevice.renderCanvas(surface, frame, surface.overlayCanvas);
    surface.display.setOverlayVisible(true);
  } else if (surface.overlayCanvas) {
    surface.display.setOverlayVisible(false);
  }
  return guideStats;
}
