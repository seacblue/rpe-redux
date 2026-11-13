/** Owns the frozen facade for read-only preview and timeline hit testing. */
import { type ApiAvailability, type ApiResult } from "./contract.ts";
import { getHitTestApi } from "../edit/hitTest/api.ts";
import { isEventTrack } from "../global/chart/chartVocabulary.ts";
import { availabilityFor, errorResult, frozenPoint, unavailableResult } from "./support.ts";
import type {
  HitTestApiHost,
  HitTestAtRequest,
  HitTestAtResult,
  HitTestAtSnapshot,
  HitTestPreviewGeometry,
  HitTestRequest,
  HitTestResult,
  HitTestValue,
} from "../edit/hitTest/api.ts";

/** Whether a request carries a known surface, finite point, and valid options. */
function validRequest(request: HitTestRequest): boolean {
  return Boolean(
    request &&
    (request.surface === "preview" || request.surface === "timeline") &&
    (request.area === undefined || request.area === "notes" || request.area === "events") &&
    Number.isFinite(request.point.x) &&
    Number.isFinite(request.point.y) &&
    (request.mode === undefined || request.mode === "topmost" || request.mode === "all") &&
    (request.tolerance === undefined ||
      (Number.isFinite(request.tolerance) && request.tolerance >= 0)),
  );
}

/** Whether a temporal selector contains exactly one finite chart position. */
function validTime(request: HitTestAtRequest): boolean {
  const seconds = request.time?.seconds;
  const beat = request.time?.beat;
  const hasSeconds = seconds !== undefined;
  const hasBeat = beat !== undefined;
  if (hasSeconds === hasBeat) {
    return false;
  }
  if (hasSeconds && (typeof seconds !== "number" || !Number.isFinite(seconds))) {
    return false;
  }
  if (hasBeat) {
    if (typeof beat === "number") {
      return Number.isFinite(beat);
    }
    return (
      Array.isArray(beat) && beat.length === 3 && beat.every(Number.isSafeInteger) && beat[2] > 0
    );
  }
  return true;
}

/** Whether a temporal query has valid filters and the required timeline context. */
function validAtRequest(request: HitTestAtRequest): boolean {
  if (!request || typeof request !== "object") {
    return false;
  }
  const includes = request.include;
  const validIncludes =
    includes === undefined ||
    (Array.isArray(includes) &&
      includes.every((kind) => kind === "note" || kind === "judgeLine" || kind === "event"));
  const includedKinds = Array.isArray(includes)
    ? includes
    : includes === undefined
      ? ["note", "judgeLine", "event"]
      : [];
  const validIndex = (value: number | undefined): boolean =>
    value === undefined || (Number.isSafeInteger(value) && value >= 0);
  const validLimit =
    request.limit === undefined || (Number.isSafeInteger(request.limit) && request.limit > 0);
  const validEventTypes =
    request.eventTypes === undefined ||
    (Array.isArray(request.eventTypes) &&
      request.eventTypes.length > 0 &&
      request.eventTypes.every((type) => type === "noiseActiveEvents" || isEventTrack(type)));
  const requiresEventLayer = includedKinds.includes("event");
  return Boolean(
    request &&
    (request.surface === "preview" || request.surface === "timeline") &&
    validTime(request) &&
    validIncludes &&
    validIndex(request.lineIndex) &&
    (request.lineId === undefined ||
      (typeof request.lineId === "string" && request.lineId.length > 0)) &&
    validIndex(request.eventLayer) &&
    validLimit &&
    validEventTypes &&
    (request.coordinateSpace === undefined || request.coordinateSpace === "chart-time") &&
    (!requiresEventLayer || request.eventLayer !== undefined) &&
    (request.surface !== "timeline" ||
      ((request.lineIndex !== undefined || request.lineId !== undefined) &&
        request.eventLayer !== undefined &&
        request.coordinateSpace === "chart-time")),
  );
}

/** Freeze a result list and every result point. */
function frozenResults(results: readonly HitTestResult[]): readonly HitTestResult[] {
  return Object.freeze(
    results.map((result) =>
      Object.freeze({
        ...result,
        point: frozenPoint(result.point),
      }),
    ),
  );
}

/** Freeze temporal hits, including their normalized time and beat ranges. */
function frozenAtResults(results: readonly HitTestAtResult[]): readonly HitTestAtResult[] {
  const frozenValue = (value: HitTestValue | undefined): HitTestValue | undefined =>
    Array.isArray(value) ? Object.freeze([...value]) : value;
  return Object.freeze(
    results.map((result) =>
      Object.freeze({
        ...result,
        ...(result.eventValue === undefined ? {} : { eventValue: frozenValue(result.eventValue) }),
        ...(result.eventStart === undefined ? {} : { eventStart: frozenValue(result.eventStart) }),
        ...(result.eventEnd === undefined ? {} : { eventEnd: frozenValue(result.eventEnd) }),
        time: Object.freeze({
          ...result.time,
          beat: Object.freeze([...result.time.beat] as [number, number, number]),
        }),
        ...(result.startTime
          ? { startTime: Object.freeze([...result.startTime] as [number, number, number]) }
          : {}),
        ...(result.endTime
          ? { endTime: Object.freeze([...result.endTime] as [number, number, number]) }
          : {}),
      }),
    ),
  );
}

/** Freeze a temporal response and its detached hit list. */
function frozenAtSnapshot(snapshot: HitTestAtSnapshot): HitTestAtSnapshot {
  return Object.freeze({
    chartFingerprint: snapshot.chartFingerprint,
    generation: snapshot.generation,
    totalHits: snapshot.totalHits,
    truncated: snapshot.truncated,
    ordering: snapshot.ordering,
    hits: frozenAtResults(snapshot.hits),
  });
}

/** A structured unavailable result for a call made before mount. */
function unavailable<T>(): ApiResult<T> {
  return unavailableResult<T>("No editor hit-test runtime connected");
}

/** Map a thrown host error onto the public error contract. */
function failure(error: unknown): ApiResult<readonly HitTestResult[]> {
  return errorResult(error);
}

/** Map a thrown host error onto the temporal hit-test result contract. */
function temporalFailure(error: unknown): ApiResult<HitTestAtSnapshot> {
  return errorResult(error);
}

/** Freeze the viewport, note, and line geometry of one preview frame. */
function frozenGeometry(geometry: HitTestPreviewGeometry): HitTestPreviewGeometry {
  return Object.freeze({
    ...geometry,
    viewport: Object.freeze({ ...geometry.viewport }),
    notes: Object.freeze(
      geometry.notes.map((note) =>
        Object.freeze({
          ...note,
          head: frozenPoint(note.head),
          tail: frozenPoint(note.tail),
        }),
      ),
    ),
    lines: Object.freeze(
      geometry.lines.map((line) =>
        Object.freeze({
          ...line,
          center: frozenPoint(line.center),
          corners: Object.freeze(line.corners.map((point) => frozenPoint(point))),
        }),
      ),
    ),
  });
}

/** Preview and timeline hit testing exposed to plugins. */
export const hitTest = Object.freeze({
  /** Report whether a hit-test runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getHitTestApi(), "No editor hit-test runtime connected");
  },
  /** Pick objects at one point; returns the topmost hit unless `mode` is "all". */
  pick(request: HitTestRequest): ApiResult<readonly HitTestResult[]> {
    if (!validRequest(request)) {
      return {
        ok: false,
        error: { code: "invalid_request", message: "Invalid hit-test request" },
      };
    }
    const api: HitTestApiHost | null = getHitTestApi();
    if (!api) {
      return unavailable();
    }
    try {
      const results = api.pick(request);
      return {
        ok: true,
        value: frozenResults(request.mode === "all" ? results : results.slice(0, 1)),
      };
    } catch (error) {
      return failure(error);
    }
  },
  /** Return chart objects active at an explicit time without touching editor state. */
  queryAt(request: HitTestAtRequest): ApiResult<HitTestAtSnapshot> {
    if (!validAtRequest(request)) {
      return {
        ok: false,
        error: { code: "invalid_request", message: "Invalid hit-test time request" },
      };
    }
    const api: HitTestApiHost | null = getHitTestApi();
    if (!api) {
      return unavailable();
    }
    try {
      return { ok: true, value: frozenAtSnapshot(api.queryAt(request)) };
    } catch (error) {
      return temporalFailure(error);
    }
  },
  /** The latest preview collision geometry, or unavailable when unsupported. */
  geometry(): ApiResult<HitTestPreviewGeometry> {
    const api: HitTestApiHost | null = getHitTestApi();
    if (!api) {
      return unavailable();
    }
    if (!api.getPreviewGeometry) {
      return {
        ok: false,
        error: { code: "unavailable", message: "Preview collision geometry is not supported" },
      };
    }
    try {
      const geometry = api.getPreviewGeometry();
      return geometry
        ? { ok: true, value: frozenGeometry(geometry) }
        : {
            ok: false,
            error: { code: "unavailable", message: "Preview collision geometry is unavailable" },
          };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});

export type {
  HitTestArea,
  HitTestAtRequest,
  HitTestAtResult,
  HitTestAtSnapshot,
  HitTestAtOrdering,
  HitTestCoordinateSpace,
  HitTestEventLayer,
  HitTestEventType,
  HitTestKind,
  HitTestLineGeometry,
  HitTestMode,
  HitTestNoteGeometry,
  HitTestPoint,
  HitTestPreviewGeometry,
  HitTestRequest,
  HitTestResult,
  HitTestSurface,
  HitTestTime,
  HitTestTimeRequest,
  HitTestValue,
} from "../edit/hitTest/api.ts";
