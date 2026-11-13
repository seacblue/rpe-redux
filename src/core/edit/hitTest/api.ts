/** Runtime seam for read-only hit testing across editor surfaces. */
import { createLateBound } from "../../utils/lateBound.ts";
import type { EventTrackName } from "../../global/chart/chartVocabulary.ts";

export type HitTestSurface = "preview" | "timeline";
export type HitTestArea = "notes" | "events";
export type HitTestKind = "note" | "judgeLine" | "event";
export type HitTestMode = "topmost" | "all";
export type HitTestCoordinateSpace = "chart-time";
export type HitTestEventLayer = number | "extended";
export type HitTestValue = number | readonly number[] | string | null;
/** Event tracks accepted by a temporal query, including the synthetic noise track. */
export type HitTestEventType = EventTrackName | "noiseActiveEvents";
/** Stable ordering applied to every temporal query response. */
export type HitTestAtOrdering = "lineIndex,notes,judgeLine,eventTrack,eventIndex";

/** A temporal selector; exactly one of seconds or beat is required. */
export interface HitTestTimeRequest {
  readonly seconds?: number;
  readonly beat?: number | readonly number[];
}

/** A normalized chart time returned with every temporal hit. */
export interface HitTestTime {
  readonly seconds: number;
  readonly beat: readonly [number, number, number];
}

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

/** One chart object active at a requested time without changing editor state. */
export interface HitTestAtResult {
  readonly kind: HitTestKind;
  readonly objectId: string;
  /** Stable judge-line id; the index remains only as a display-position hint. */
  readonly lineId: string;
  readonly lineIndex: number;
  readonly coordinateSpace: HitTestCoordinateSpace;
  readonly time: HitTestTime;
  /** Numeric source layer, or `extended` for tracks outside base layers. */
  readonly eventLayer?: HitTestEventLayer;
  readonly startTime?: readonly [number, number, number];
  readonly endTime?: readonly [number, number, number];
  readonly noteType?: number;
  readonly noteIndex?: number;
  readonly eventType?: string;
  readonly eventIndex?: number;
  readonly eventValue?: HitTestValue;
  readonly eventStart?: HitTestValue;
  readonly eventEnd?: HitTestValue;
  readonly easingType?: number;
  readonly easingLeft?: number;
  readonly easingRight?: number;
}

/** One read-consistent temporal hit-test response. */
export interface HitTestAtSnapshot {
  readonly chartFingerprint: string | null;
  readonly generation: number;
  /** Number of matching objects before the result limit was applied. */
  readonly totalHits: number;
  /** True when at least one matching object was omitted by `limit`. */
  readonly truncated: boolean;
  /** Stable traversal order for `hits`; filters never reorder the list. */
  readonly ordering: HitTestAtOrdering;
  readonly hits: readonly HitTestAtResult[];
}

/** Selects chart objects at one explicit chart time. */
export interface HitTestAtRequest {
  readonly surface: HitTestSurface;
  readonly time: HitTestTimeRequest;
  /** Positional line selector; prefer `lineId` when a caller will write later. */
  readonly lineIndex?: number;
  /** Stable line selector; may replace `lineIndex`. */
  readonly lineId?: string;
  readonly eventLayer?: number;
  readonly coordinateSpace?: HitTestCoordinateSpace;
  readonly include?: readonly HitTestKind[];
  /** Maximum number of hits returned; the host applies a bounded default. */
  readonly limit?: number;
  /** Restrict event hits while preserving the public traversal order. */
  readonly eventTypes?: readonly HitTestEventType[];
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
  queryAt(request: HitTestAtRequest): HitTestAtSnapshot;
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
