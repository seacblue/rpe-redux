/**
 * Applies frame output to React-owned preview canvases: viewport clipping,
 * layer visibility, and opacity. The preview runtime decides what to show; this
 * adapter owns only the DOM writes.
 */
import { measureCanvas } from "../../../canvas/canvas2d.ts";
import type { PreviewViewportBounds } from "../scene/viewport.ts";
import type { PreviewSurfaceKind } from "../scene/previewTypes.ts";

/** DOM-facing operations that present one painted preview frame. */
export interface PreviewDisplayAdapter {
  readonly kind: PreviewSurfaceKind;
  /**
   * Clip the preview layers to `viewport` and position the free-camera frame.
   *
   * `contentFrame` is the chart frame projected through the free camera; it is
   * relative to the cookie-cutter `viewport` clip so the outline moves and
   * scales with the background.
   */
  setViewportClip(
    viewport: PreviewViewportBounds,
    viewDivisor?: number,
    contentFrame?: PreviewViewportBounds,
  ): void;
  /** Sets the primary canvas opacity, skipping unchanged writes. */
  setPrimaryOpacity(value: number): void;
  /** Sets the note-batch canvas opacity, skipping unchanged writes. */
  setNoteBatchOpacity(value: number): void;
  /** Shows or hides the shader canvas, skipping unchanged writes. */
  setShaderVisible(visible: boolean): void;
  /** Sets the shader canvas opacity, keeping it aligned with the preview underlay. */
  setShaderOpacity(value: number): void;
  /** Sets the overlay canvas opacity, skipping unchanged writes. */
  setOverlayOpacity(value: number): void;
  /** Shows or hides the overlay canvas, skipping unchanged writes. */
  setOverlayVisible(visible: boolean): void;
  /** Clears DOM writes and collapses the layers owned by this adapter. */
  dispose(): void;
}

/** Lazily resolves the React-owned canvas nodes; any layer may be absent. */
interface PreviewDisplayNodes {
  primary(): HTMLCanvasElement | null;
  noteBatch?(): HTMLCanvasElement | null;
  shader(): HTMLCanvasElement | null;
  overlay(): HTMLCanvasElement | null;
}

/** Adapts imperative frame output to React-owned canvas nodes at one seam. */
export function createPreviewDisplay(
  nodes: PreviewDisplayNodes,
  kind: PreviewSurfaceKind,
): PreviewDisplayAdapter {
  let lastClipKey = "";
  let lastPrimaryOpacity = Number.NaN;
  let lastNoteBatchOpacity = Number.NaN;
  let lastShaderOpacity = Number.NaN;
  let lastShaderVisible: boolean | null = null;
  let lastOverlayOpacity = Number.NaN;
  let lastOverlayVisible: boolean | null = null;
  /** Writes an opacity value and returns it, or keeps the previous value. */
  const writeOpacity = (
    canvas: HTMLCanvasElement | null,
    value: number,
    previous: number,
  ): number => {
    if (!canvas || Object.is(previous, value)) {
      return previous;
    }
    canvas.style.opacity = String(value);
    return value;
  };
  /** Writes a visibility value and returns it, or keeps the previous value. */
  const writeVisibility = (
    canvas: HTMLCanvasElement | null,
    visible: boolean,
    previous: boolean | null,
  ): boolean | null => {
    if (!canvas || previous === visible) {
      return previous;
    }
    canvas.style.visibility = visible ? "visible" : "hidden";
    return visible;
  };
  return {
    kind,
    setViewportClip(viewport, viewDivisor = 1, contentFrame) {
      const contentKey = contentFrame
        ? `${contentFrame.left}:${contentFrame.top}:${contentFrame.width}:${contentFrame.height}`
        : "";
      const key = `${viewport.left}:${viewport.top}:${viewport.width}:${viewport.height}:${viewDivisor}:${contentKey}`;
      if (key === lastClipKey) {
        return;
      }
      lastClipKey = key;
      const primary = nodes.primary();
      const canvases = [primary, nodes.noteBatch?.(), nodes.shader(), nodes.overlay()].filter(
        (canvas): canvas is HTMLCanvasElement => canvas != null,
      );
      if (!canvases.length) {
        return;
      }
      const bounds = primary ? measureCanvas(primary) : null;
      const width =
        kind === "workspace-underlay" ? (primary?.clientWidth ?? 0) : (bounds?.width ?? 0);
      const height =
        kind === "workspace-underlay" ? (primary?.clientHeight ?? 0) : (bounds?.height ?? 0);
      if (width <= 0 || height <= 0) {
        return;
      }
      const right = Math.max(0, width - viewport.left - viewport.width);
      const bottom = Math.max(0, height - viewport.top - viewport.height);
      const clip = `inset(${viewport.top}px ${right}px ${bottom}px ${viewport.left}px)`;
      for (const canvas of canvases) {
        canvas.style.clipPath = clip;
      }
      if (kind === "workspace-underlay" && primary?.parentElement) {
        const frameWidth = viewport.width / viewDivisor;
        const frameHeight = viewport.height / viewDivisor;
        const frameLeft = viewport.left + (viewport.width - frameWidth) / 2;
        const frameTop = viewport.top + (viewport.height - frameHeight) / 2;
        const content = contentFrame ?? {
          left: frameLeft,
          top: frameTop,
          width: frameWidth,
          height: frameHeight,
        };
        const style = primary.parentElement.style;
        style.setProperty("--preview-frame-left", `${frameLeft}px`);
        style.setProperty("--preview-frame-top", `${frameTop}px`);
        style.setProperty("--preview-frame-width", `${frameWidth}px`);
        style.setProperty("--preview-frame-height", `${frameHeight}px`);
        // The outline is positioned inside the viewport-sized clip wrapper, so
        // the camera offset is relative to the fitted frame rather than the
        // stage. `overflow: hidden` on that wrapper keeps an enlarged chart
        // frame from spilling into the letterbox around the preview.
        style.setProperty("--free-camera-frame-left", `${content.left - frameLeft}px`);
        style.setProperty("--free-camera-frame-top", `${content.top - frameTop}px`);
        style.setProperty("--free-camera-frame-width", `${content.width}px`);
        style.setProperty("--free-camera-frame-height", `${content.height}px`);
      }
    },
    setPrimaryOpacity(value) {
      lastPrimaryOpacity = writeOpacity(nodes.primary(), value, lastPrimaryOpacity);
    },
    setNoteBatchOpacity(value) {
      lastNoteBatchOpacity = writeOpacity(nodes.noteBatch?.() ?? null, value, lastNoteBatchOpacity);
    },
    setShaderOpacity(value) {
      lastShaderOpacity = writeOpacity(nodes.shader(), value, lastShaderOpacity);
    },
    setShaderVisible(visible) {
      lastShaderVisible = writeVisibility(nodes.shader(), visible, lastShaderVisible);
    },
    setOverlayOpacity(value) {
      lastOverlayOpacity = writeOpacity(nodes.overlay(), value, lastOverlayOpacity);
    },
    setOverlayVisible(visible) {
      lastOverlayVisible = writeVisibility(nodes.overlay(), visible, lastOverlayVisible);
    },
    dispose() {
      lastClipKey = "";
      lastPrimaryOpacity = Number.NaN;
      lastNoteBatchOpacity = Number.NaN;
      lastShaderOpacity = Number.NaN;
      lastShaderVisible = null;
      lastOverlayOpacity = Number.NaN;
      lastOverlayVisible = null;
      for (const canvas of [
        nodes.primary(),
        nodes.noteBatch?.(),
        nodes.shader(),
        nodes.overlay(),
      ]) {
        if (canvas) {
          canvas.style.clipPath = "";
          canvas.width = canvas.height = 1;
          canvas.style.visibility = "hidden";
        }
      }
    },
  };
}
