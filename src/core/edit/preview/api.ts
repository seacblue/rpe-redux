/**
 * Runtime seam for read-only live geometry of objects drawn in the preview.
 *
 * The preview owns sampling and painting; this contract exposes one frozen
 * snapshot per painted frame without leaking the renderer, chart, or DOM. All
 * points are CSS pixels: `client` is relative to the application viewport,
 * while `surface` is relative to the preview canvas's top-left corner.
 */
import { createLateBound } from "../../utils/lateBound.ts";
import type { PreviewFrameImage, PreviewFrameSpec } from "./frame.ts";

export type PreviewObjectKind = "note" | "hold" | "judgeLine";

export interface PreviewPoint {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in CSS pixels. */
export interface PreviewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Oriented anchors for one preview object. */
export interface PreviewObjectGeometry {
  /** Object centre. */
  readonly center: PreviewPoint;
  /** Note head anchor, or the judge line centre. */
  readonly head: PreviewPoint;
  /** Hold tail anchor, its painted end; equal to `head` for taps and judge lines. */
  readonly tail: PreviewPoint;
  /** Oriented box corners, starting at the top-left in the object's local space. */
  readonly corners: readonly PreviewPoint[];
}

/** Authored note fields exposed beside one painted preview object. */
export interface PreviewObjectDebug {
  readonly startTime?: readonly number[];
  readonly endTime?: readonly number[];
  readonly positionX?: number;
  readonly type?: number;
  readonly above?: number | string | null;
  readonly speed?: number;
  readonly size?: number;
  readonly isFake?: number;
  readonly yOffset?: number;
}

/** One note, hold, or judge line currently visible in the preview. */
export interface PreviewObject {
  /** Stable chart object id, or an index fallback when the chart has no id. */
  readonly id: string;
  readonly kind: PreviewObjectKind;
  /** Authored note fields when this object is a note or hold. */
  readonly debug?: PreviewObjectDebug;
  readonly lineIndex: number;
  /** Note index inside its judge line; absent for judge lines. */
  readonly noteIndex?: number;
  /** Geometry in client (application viewport) CSS pixels. */
  readonly client: PreviewObjectGeometry;
  /** Geometry relative to the preview canvas's top-left corner. */
  readonly surface: PreviewObjectGeometry;
  /** Oriented box width in CSS pixels. */
  readonly width: number;
  /** Oriented box length in CSS pixels; hold length, note height, or line height. */
  readonly height: number;
  /** Useful longitudinal size of a Hold's head cap in CSS pixels. */
  readonly headLength?: number;
  /** Useful longitudinal size of a Hold's tail cap in CSS pixels. */
  readonly tailLength?: number;
  /** Whether the painted Hold includes its head cap. */
  readonly showHead?: boolean;
  /** Clockwise rotation in degrees. */
  readonly rotation: number;
  /** Preview pick radius in CSS pixels; zero for judge lines. */
  readonly radius: number;
}

/** One painted preview frame with the objects that were visible in it. */
export interface PreviewSnapshot {
  /** Monotonic draw revision; increases once per painted preview frame. */
  readonly revision: number;
  /** Chart time shown by this frame, in seconds. */
  readonly seconds: number;
  /** Canvas rectangle in client CSS pixels. */
  readonly bounds: PreviewRect;
  /** Painted preview frame inside the canvas, in canvas CSS pixels. */
  readonly viewport: PreviewRect;
  /** Canvas CSS width. */
  readonly width: number;
  /** Canvas CSS height. */
  readonly height: number;
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly devicePixelRatio: number;
  readonly objects: readonly PreviewObject[];
}

/** Host operations behind the public `redux.preview` facade. */
export interface PreviewApiHost {
  /** Snapshot of the last painted frame, or null before the first frame. */
  snapshot(): PreviewSnapshot | null;
  /**
   * Observe every painted preview frame. The listener receives null when the
   * document is cleared or the live preview is hidden.
   */
  subscribe(listener: (snapshot: PreviewSnapshot | null) => void): () => void;
  /**
   * Render one chart frame into an encoded image without changing the live
   * preview or playback position. The request is already normalized.
   */
  frame(request: PreviewFrameSpec): Promise<PreviewFrameImage>;
}

const previewApiBinding = createLateBound<PreviewApiHost>();
const previewApiListeners = new Set<() => void>();

/** Notifies mounted listeners that the preview host attached or detached. */
function notifyPreviewApiChange(): void {
  for (const listener of [...previewApiListeners]) {
    try {
      listener();
    } catch (error) {
      console.error("Preview API listener failed", error);
    }
  }
}

/** Binds the preview host and notifies listeners; returns the disposer. */
export function connectPreviewApi(host: PreviewApiHost): () => void {
  const dispose = previewApiBinding.bind(host);
  notifyPreviewApiChange();
  return () => {
    dispose();
    notifyPreviewApiChange();
  };
}

/** The mounted preview host, or null while no preview is bound. */
export function getPreviewApi(): PreviewApiHost | null {
  return previewApiBinding.value();
}

/** Notify when the mounted preview runtime attaches or detaches. */
export function onPreviewApiChange(listener: () => void): () => void {
  previewApiListeners.add(listener);
  return () => {
    previewApiListeners.delete(listener);
  };
}
