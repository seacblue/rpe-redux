/** Runtime seam for read-only hit testing across editor surfaces. */
import { createLateBound } from "../../utils/lateBound.ts";

export type HitTestSurface = "preview" | "timeline";
export type HitTestArea = "notes" | "events";
export type HitTestKind = "note" | "judgeLine" | "event";
export type HitTestMode = "topmost" | "all";

export interface HitTestPoint {
  x: number;
  y: number;
}

export interface HitTestRequest {
  surface: HitTestSurface;
  area?: HitTestArea;
  point: HitTestPoint;
  include?: readonly HitTestKind[];
  mode?: HitTestMode;
  tolerance?: number;
}

export interface HitTestResult {
  kind: HitTestKind;
  objectId: string;
  lineIndex: number;
  distance: number;
  point: HitTestPoint;
  coordinateSpace: "css-px";
  noteIndex?: number;
  eventType?: string;
  eventIndex?: number;
}

export interface HitTestNoteGeometry {
  lineIndex: number;
  noteIndex: number;
  kind: "note" | "hold";
  head: HitTestPoint;
  tail: HitTestPoint;
  radius: number;
  width: number;
  /** Drawn note height in CSS pixels; holds use the head/tail span instead. */
  height?: number;
  /** Useful longitudinal size of the Hold head/tail cap in CSS pixels. */
  headLength?: number;
  tailLength?: number;
  /** Whether the painted Hold includes its head cap. */
  showHead?: boolean;
  rotation: number;
}

export interface HitTestLineGeometry {
  lineIndex: number;
  center: HitTestPoint;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  corners: readonly HitTestPoint[];
  texture: string;
}

export interface HitTestPreviewGeometry {
  surface: "preview";
  revision: number;
  seconds: number;
  width: number;
  height: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  devicePixelRatio: number;
  viewport: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  notes: readonly HitTestNoteGeometry[];
  lines: readonly HitTestLineGeometry[];
}

export interface HitTestApiHost {
  pick(request: HitTestRequest): readonly HitTestResult[];
  getPreviewGeometry?(): HitTestPreviewGeometry | null;
}

const hitTestApiBinding = createLateBound<HitTestApiHost>();

/** Binds the hit-test host; returns an idempotent disposer. */
export function connectHitTestApi(host: HitTestApiHost): () => void {
  return hitTestApiBinding.bind(host);
}

/** The mounted hit-test host, or null while no editor surface is bound. */
export function getHitTestApi(): HitTestApiHost | null {
  return hitTestApiBinding.value();
}
