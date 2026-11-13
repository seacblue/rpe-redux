/** Adapts preview and timeline-owned geometry to the public hit-test contract. */
import { eventListAt } from "../../../../../../core/edit/events/eventTracks.ts";
import { queryChartAtTime } from "../../../../../../core/edit/hitTest/query.ts";
import { getChartApi } from "../../../../../../core/edit/chart/api.ts";
import { chartFingerprint } from "../../../../../../core/edit/document/chartRevision.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type {
  HitTestAtRequest,
  HitTestAtSnapshot,
  HitTestKind,
  HitTestRequest,
  HitTestResult,
} from "../../../../../../core/edit/hitTest/api.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { Preview } from "../../preview/scene/preview.ts";
import { holdUsefulInterval } from "../../../canvas/noteGeometry.ts";
import {
  distanceSquaredToSegment,
  previewNoteGrid,
} from "../../preview/interaction/previewSpatialIndex.ts";

interface HitTestBindings {
  preview: Preview;
  timeline: Timeline;
}

const DEFAULT_TOLERANCE = 8;

/** Squared distance from a point to a filled polygon; zero when inside. */
function distanceSquaredToPolygon(
  point: { x: number; y: number },
  corners: readonly { x: number; y: number }[],
): number {
  if (corners.length < 3) {
    return Infinity;
  }
  let inside = false;
  let distance = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index];
    const next = corners[(index + 1) % corners.length];
    distance = Math.min(distance, distanceSquaredToSegment(point, current, next));
    if (current.y > point.y !== next.y > point.y) {
      const crossing =
        ((next.x - current.x) * (point.y - current.y)) / (next.y - current.y) + current.x;
      if (point.x < crossing) {
        inside = !inside;
      }
    }
  }
  return inside ? 0 : distance;
}

/** The object kinds a request accepts; all kinds when unspecified. */
function includeKinds(request: HitTestRequest): Set<HitTestKind> {
  return new Set(request.include ?? ["note", "judgeLine", "event"]);
}

/** Ranks hits by distance, breaking ties by object kind. */
function resultOrder(left: HitTestResult, right: HitTestResult): number {
  const kindOrder: Record<HitTestKind, number> = { note: 0, event: 1, judgeLine: 2 };
  return left.distance - right.distance || kindOrder[left.kind] - kindOrder[right.kind];
}

/** Hits against the preview's last committed collision geometry. */
function previewHits(
  preview: Preview,
  request: HitTestRequest,
  include: Set<HitTestKind>,
): HitTestResult[] {
  const geometry = preview.getCollisionGeometry();
  const chart = preview.chart;
  if (!geometry || !chart) {
    return [];
  }
  const results: HitTestResult[] = [];
  if (include.has("note")) {
    const tolerance = request.tolerance ?? DEFAULT_TOLERANCE;
    const grid = previewNoteGrid(geometry);
    const candidates = grid.queryPoint(request.point, grid.maxQueryRadius + tolerance);
    for (const area of candidates) {
      const interval = area.kind === "hold" ? holdUsefulInterval(area) : area;
      const limit = area.radius + tolerance;
      const distanceSquared = distanceSquaredToSegment(request.point, interval.head, interval.tail);
      if (distanceSquared > limit * limit) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      const note = chart.judgeLineList?.[area.lineIndex]?.notes?.[area.noteIndex ?? -1];
      results.push({
        kind: "note",
        objectId: note?.id ?? `line:${area.lineIndex}:note:${area.noteIndex ?? -1}`,
        lineIndex: area.lineIndex,
        noteIndex: area.noteIndex,
        distance,
        point: request.point,
        coordinateSpace: "css-px",
      });
    }
  }
  if (include.has("judgeLine")) {
    const tolerance = request.tolerance ?? DEFAULT_TOLERANCE;
    const toleranceSquared = tolerance * tolerance;
    for (const line of geometry.lines) {
      const distanceSquared = distanceSquaredToPolygon(request.point, line.corners);
      if (distanceSquared > toleranceSquared) {
        continue;
      }
      const chartLine = chart.judgeLineList?.[line.lineIndex];
      results.push({
        kind: "judgeLine",
        objectId: chartLine?.id ?? `line:${line.lineIndex}`,
        lineIndex: line.lineIndex,
        distance: Math.sqrt(distanceSquared),
        point: request.point,
        coordinateSpace: "css-px",
      });
    }
  }
  return results;
}

/** Hits against the timeline's note and event hit-test surfaces. */
function timelineHits(
  timeline: Timeline,
  request: HitTestRequest,
  include: Set<HitTestKind>,
): HitTestResult[] {
  const point = request.point;
  const session = timeline.getSession();
  const results: HitTestResult[] = [];
  if ((request.area ?? "notes") === "notes" && include.has("note")) {
    const hit = timeline.hit(point);
    if (hit) {
      results.push({
        kind: "note",
        objectId: hit.item.id ?? `line:${hit.lineIndex}:note:${hit.index}`,
        lineIndex: hit.lineIndex,
        noteIndex: hit.index,
        distance: 0,
        point,
        coordinateSpace: "css-px",
      });
    }
  }
  if ((request.area ?? "events") === "events" && include.has("event")) {
    const hit = timeline.gestures.eventInteraction.hit(point);
    if (hit) {
      const lineIndex =
        hit.lineIndex ??
        timeline.viewport.lineIndexAt(point.x, timeline.eventsCanvas.clientWidth, "events");
      const event = eventListAt(
        { chart: session.chart, lineIndex: session.lineIndex, eventLayer: timeline.gestures.layer },
        lineIndex,
        hit.type,
        timeline.gestures.layer,
      )[hit.index];
      results.push({
        kind: "event",
        objectId: event?.id ?? `line:${lineIndex}:event:${hit.type}:${hit.index}`,
        lineIndex,
        eventType: hit.type,
        eventIndex: hit.index,
        distance: 0,
        point,
        coordinateSpace: "css-px",
      });
    }
  }
  return results;
}

/** Creates the picker behind `redux.hitTest` for the mounted preview and timeline. */
export function createHitTestPicker({ preview, timeline }: HitTestBindings) {
  return (request: HitTestRequest): readonly HitTestResult[] => {
    const include = includeKinds(request);
    const results =
      request.surface === "preview"
        ? previewHits(preview, request, include)
        : timelineHits(timeline, request, include);
    results.sort(resultOrder);
    return request.mode === "all" ? results : results.slice(0, 1);
  };
}

/** Creates the chart-time query behind `redux.hitTest.queryAt`. */
export function createHitTestTimeQuery({ preview, timeline }: HitTestBindings) {
  const tempoCache = new WeakMap<Chart, { entries: Chart["BPMList"]; tempo: TempoMap }>();
  const fallbackRevisions = new WeakMap<Chart, { chartFingerprint: string; generation: number }>();
  let nextFallbackGeneration = 0;
  const tempoFor = (chart: Chart): TempoMap => {
    const cached = tempoCache.get(chart);
    if (cached?.entries === chart.BPMList) {
      return cached.tempo;
    }
    const tempo = new TempoMap(chart.BPMList);
    tempoCache.set(chart, { entries: chart.BPMList, tempo });
    return tempo;
  };
  const revisionFor = (chart: Chart): { chartFingerprint: string | null; generation: number } => {
    const fingerprint = chartFingerprint(chart);
    const mounted = getChartApi()?.state();
    if (mounted?.chartFingerprint === fingerprint) {
      return mounted;
    }
    const previous = fallbackRevisions.get(chart);
    const revision =
      previous?.chartFingerprint === fingerprint
        ? previous
        : { chartFingerprint: fingerprint, generation: ++nextFallbackGeneration };
    fallbackRevisions.set(chart, revision);
    return revision;
  };
  return (request: HitTestAtRequest): HitTestAtSnapshot => {
    const chart = request.surface === "preview" ? preview.chart : timeline.getSession().chart;
    if (!chart) {
      return {
        chartFingerprint: null,
        generation: 0,
        totalHits: 0,
        truncated: false,
        ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
        hits: [],
      };
    }
    const query = queryChartAtTime({
      chart,
      tempo: tempoFor(chart),
      request,
    });
    return { ...revisionFor(chart), ...query };
  };
}

/** Reads the preview's latest collision geometry for the public preview API. */
export function createPreviewGeometryReader({ preview }: Pick<HitTestBindings, "preview">) {
  return () => preview.getCollisionGeometry();
}
