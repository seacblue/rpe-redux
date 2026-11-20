/**
 * Timeline markers: named, coloured positions stored on the chart root.
 *
 * RPE has no native marker concept, so Redux keeps a `markers` array beside the
 * compatible chart fields; other readers ignore the unknown root key. This
 * module owns reading, normalizing, editing, and scrubber conversion for that
 * array. It stays free of React, DOM, session, and storage dependencies so both
 * the transport surfaces and the unit suite can use it.
 */
import type { Chart } from "./chart.ts";
import { createChartObjectId } from "./identity.ts";

/**
 * One timeline marker.
 *
 * `beat` is the chart beat, so a marker keeps its musical position when the
 * tempo or the chart offset changes. `color` is an optional `#rrggbb` accent; a
 * marker without one uses the theme's marker colour.
 */
export interface TimelineMarker {
  /**
   * Persistent identity, written beside the marker so editing survives a
   * rename and duplicates at one beat and name stay distinct.
   *
   * Charts written before ids existed omit it; normalization fills a stable
   * id for those markers and the next write serializes it.
   */
  id?: string;
  beat: number;
  name: string;
  color?: string;
  /** Unknown fields stay on the marker so a peer's data survives a round trip. */
  [extra: string]: unknown;
}

/** Fields an edit may replace on one marker. Identity is never part of a patch. */
export type TimelineMarkerPatch = Partial<Pick<TimelineMarker, "beat" | "name" | "color">>;

/** Tempo projection needed to migrate a marker stored in chart seconds. */
export interface MarkerTempo {
  beat(seconds: number, factor?: number): number;
}

/** The only colour form stored in a chart; the design colour input produces it. */
const MARKER_COLOR = /^#[0-9a-f]{6}$/u;

/** Prefix reserved for ids derived from markers that predate persistent ids. */
const LEGACY_MARKER_ID = "legacy";

/**
 * Normalize one marker accent to `#rrggbb`.
 *
 * Returns `undefined` for anything else, so a hand-edited chart cannot smuggle
 * arbitrary CSS into the timeline's inline style.
 */
export function normalizeMarkerColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const color = value.trim().toLowerCase();
  return MARKER_COLOR.test(color) ? color : undefined;
}

/** Whether a raw value can be stored as a marker without losing information. */
function usableMarker(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** Return a stored id when it is a non-empty string, ignoring surrounding space. */
function storedMarkerId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value.trim();
  return id || undefined;
}

/**
 * Stable content hash for the id of a marker that has none.
 *
 * The fallback identity must survive repeated reads of the same legacy chart,
 * so it is derived from the marker rather than generated randomly.
 */
function markerContentHash(beat: number, name: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${beat}\u0000${name}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Deterministic id for one marker whose chart predates persistent ids. */
function legacyMarkerId(beat: number, name: string, occurrence: number): string {
  return `${LEGACY_MARKER_ID}-${markerContentHash(beat, name)}-${occurrence.toString(36)}`;
}

/**
 * Claim `base` as a unique id, suffixing it when an assigned id or a reserved
 * stored id already owns it.
 */
function claimMarkerId(base: string, used: Set<string>, reserved?: Set<string>): string {
  let id = base;
  let suffix = 1;
  while (used.has(id) || reserved?.has(id)) {
    id = `${base}~${suffix.toString(36)}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

/**
 * Give every marker in a normalized collection a unique persistent id.
 *
 * Stored ids win. A missing or blank id is derived from the marker's content
 * and its occurrence among equal content, so two identical markers at one beat
 * stay distinct and repeated reads of one legacy chart stay stable. Derived ids
 * never take a stored id, and a stored id already claimed by an earlier marker
 * keeps its first owner; later copies get a deterministic suffix. The input
 * objects are not mutated.
 */
function withMarkerIds(markers: readonly TimelineMarker[]): TimelineMarker[] {
  const reserved = new Set<string>();
  for (const marker of markers) {
    const stored = storedMarkerId(marker.id);
    if (stored) {
      reserved.add(stored);
    }
  }
  const used = new Set<string>();
  // Keep the first marker for every stored id before suffixing later copies, so
  // a duplicate never displaces an id another marker already owns.
  const firstOwner = markers.map((marker) => {
    const stored = storedMarkerId(marker.id);
    if (!stored || used.has(stored)) {
      return undefined;
    }
    used.add(stored);
    return stored;
  });
  const occurrences = new Map<string, number>();
  return markers.map((marker, index) => {
    const content = `${marker.beat}\u0000${marker.name}`;
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    const owned = firstOwner[index];
    if (owned) {
      return { ...marker, id: owned };
    }
    const stored = storedMarkerId(marker.id);
    const base = stored ?? legacyMarkerId(marker.beat, marker.name, occurrence);
    return { ...marker, id: claimMarkerId(base, used, reserved) };
  });
}

/**
 * Normalize one unsorted marker collection.
 *
 * Markers without a finite, non-negative beat or a non-empty name are dropped;
 * names are trimmed, accents are validated, and the result is sorted by beat so
 * every surface sees the same order. Unknown fields on kept markers survive.
 * Every returned marker carries a unique id: stored ids are kept, while legacy
 * markers without one receive a deterministic content-based id.
 *
 * `secondsToBeat` reads markers written by older builds that stored chart
 * seconds in `time`; a stored `beat` always wins, and the legacy field is
 * removed from the result. Without the projection a time-only marker is
 * dropped because it has no defined musical position.
 */
export function normalizeTimelineMarkers(
  values: readonly unknown[],
  secondsToBeat?: (seconds: number) => number,
): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const value of values) {
    if (!usableMarker(value)) {
      continue;
    }
    let beat = Number(value.beat);
    if (!Number.isFinite(beat) && secondsToBeat) {
      const seconds = Number(value.time);
      if (Number.isFinite(seconds) && seconds >= 0) {
        try {
          beat = secondsToBeat(seconds);
        } catch {
          beat = Number.NaN;
        }
      }
    }
    const name = String(value.name ?? "").trim();
    if (!Number.isFinite(beat) || beat < 0 || !name) {
      continue;
    }
    const marker: TimelineMarker = { ...value, beat, name };
    delete marker.time;
    const color = normalizeMarkerColor(value.color);
    if (color) {
      marker.color = color;
    } else {
      delete marker.color;
    }
    markers.push(marker);
  }
  markers.sort((left, right) => left.beat - right.beat);
  return withMarkerIds(markers);
}

/**
 * Read the normalized markers of one chart, including a stable id for each.
 *
 * Passing `tempo` also upgrades markers written by older builds with a `time`
 * value in chart seconds; the next write serializes their beat instead.
 */
export function readTimelineMarkers(chart: Chart, tempo?: MarkerTempo): TimelineMarker[] {
  const raw = (chart as { markers?: unknown }).markers;
  const secondsToBeat = tempo ? (seconds: number) => tempo.beat(seconds, 1) : undefined;
  return normalizeTimelineMarkers(Array.isArray(raw) ? raw : [], secondsToBeat);
}

/** Create the persistent id for a newly added marker. */
export function createTimelineMarkerId(): string {
  return createChartObjectId();
}

/**
 * Convert one marker's chart seconds to its audio time on the scrubber.
 *
 * Marker beats are converted to chart seconds by the caller's tempo map; those
 * seconds exclude `META.offset`, while the scrubber runs on audio time. The
 * result is clamped to `[0, duration]`, so a marker before the audio or past
 * its end stays on the visible bar instead of drawing outside it.
 */
export function markerAudioSeconds(
  chartSeconds: number,
  offsetSeconds: number,
  duration: number,
): number {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const markerSeconds = Number.isFinite(chartSeconds) ? chartSeconds : 0;
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return Math.min(Math.max(markerSeconds + offset, 0), total);
}

/** The marker's position on the audio scrubber, in the closed range `[0, 1]`. */
export function markerAudioRatio(
  chartSeconds: number,
  offsetSeconds: number,
  duration: number,
): number {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return total > 0 ? markerAudioSeconds(chartSeconds, offsetSeconds, total) / total : 0;
}

/** Write normalized markers, including their persistent ids, back to a chart. */
export function writeTimelineMarkers(chart: Chart, markers: readonly TimelineMarker[]): Chart {
  return { ...chart, markers: normalizeTimelineMarkers(markers) };
}

/** Append one marker and return the normalized, beat-sorted collection with ids. */
export function addTimelineMarker(
  markers: readonly TimelineMarker[],
  marker: TimelineMarker,
): TimelineMarker[] {
  return normalizeTimelineMarkers([...markers, marker]);
}

/**
 * Replace fields on the marker whose id is `id`.
 *
 * A patch that clears `color` removes the stored accent rather than keeping an
 * empty string, and a changed beat re-sorts the collection. The marker keeps
 * its id. An unknown id leaves the normalized collection unchanged.
 */
export function updateTimelineMarker(
  markers: readonly TimelineMarker[],
  id: string,
  patch: TimelineMarkerPatch,
): TimelineMarker[] {
  const current = normalizeTimelineMarkers(markers);
  const index = current.findIndex((marker) => marker.id === id);
  if (index < 0) {
    return current;
  }
  const next = current.map((marker, position) =>
    position === index ? { ...marker, ...patch, id: marker.id } : marker,
  );
  return normalizeTimelineMarkers(next);
}

/** Remove the marker whose id is `id`; an unknown id leaves the collection unchanged. */
export function removeTimelineMarker(
  markers: readonly TimelineMarker[],
  id: string,
): TimelineMarker[] {
  const current = normalizeTimelineMarkers(markers);
  const index = current.findIndex((marker) => marker.id === id);
  if (index < 0) {
    return current;
  }
  return normalizeTimelineMarkers(current.filter((_, position) => position !== index));
}
