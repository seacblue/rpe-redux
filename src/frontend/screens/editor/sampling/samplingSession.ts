/**
 * The live workspace sampling session.
 *
 * Opening a sampler leaves the event inspector for the sampling pane, enters the
 * free camera, and owns the draft start/end anchors and easing curve the
 * workspace is previewing. Closing it restores the camera the user had before
 * sampling. Chart mutation stays in `core/edit/sampling/sampling.ts`; this module
 * only coordinates the surfaces and hands one draft to the core commit.
 */
import { createValue } from "../../../../core/state/values.ts";
import {
  applySamplingAnchors,
  samplingAxisForEventType,
  samplingXYBindingEnabled,
  samplingSettings,
  type SamplingCurve,
  type SamplingTarget,
  type SamplingValue,
} from "../../../../core/edit/sampling/sampling.ts";
import { selectedEvents } from "../../../../core/edit/events/eventEdits.ts";
import { eventListAt } from "../../../../core/edit/events/eventTracks.ts";
import type { EditorSession } from "../../../../core/edit/session/session.ts";
import { clamp01 } from "../../../../core/utils/numbers.ts";
import { openInspector } from "../inspector/controller.ts";
import {
  borrowFreeCamera,
  releaseFreeCamera,
  setFreeCameraView,
  type FreeCameraState,
} from "../workspace/stage/freeCamera/freeCamera.ts";

/**
 * The curve fields the sampler may write with its anchors.
 *
 * Every field is optional because an event carries only the parts it uses; the
 * commit fills the defaults the same way the event inspector does.
 */
export type SamplingCurveDraft = SamplingCurve;

/** The two anchor values being sampled for one event. */
export interface SamplingDraft {
  start: SamplingValue | null;
  end: SamplingValue | null;
  curve: SamplingCurveDraft;
}

/** What the workspace is currently sampling and the draft it shows. */
export interface SamplingSessionState {
  target: SamplingTarget | null;
  draft: SamplingDraft;
  /** Original event anchors restored when the current sampling attempt is cancelled. */
  initialAnchors: Pick<SamplingDraft, "start" | "end">;
  /** Easing id kept beside the draft so a surface can show the selected curve. */
  easingType: number;
  /** True once a completed drag produced both anchors. */
  locked: boolean;
  /** True while an overlay drag owns the pointer. */
  dragging: boolean;
}

const EMPTY_DRAFT: SamplingDraft = { start: null, end: null, curve: {} };

const EMPTY_SESSION: SamplingSessionState = {
  target: null,
  draft: EMPTY_DRAFT,
  initialAnchors: { start: null, end: null },
  easingType: 1,
  locked: false,
  dragging: false,
};

/** The single sampling session shared by the pane and the workspace overlay. */
export const samplingSession = createValue<SamplingSessionState>({ initial: EMPTY_SESSION });

/** True while a sampling target owns the workspace and the pane. */
export function samplingActive(): boolean {
  return samplingSession.get().target !== null;
}

/** Camera state captured when sampling began; null while no session is open. */
let previousCamera: FreeCameraState | null = null;

/** The event a sampler starts on, addressed by its stable layer/type/index. */
export interface StartSamplingEventOptions {
  lineIndex: number;
  eventType: string;
  eventIndex: number;
  eventId?: string;
  eventLayer: number;
}

/** A numeric event anchor as a draft value, or null when the anchor is not numeric. */
function anchorValue(
  event: { start?: unknown; end?: unknown },
  field: "start" | "end",
  axis: SamplingTarget["axis"],
): SamplingValue | null {
  const value = event[field];
  return typeof value === "number" && Number.isFinite(value) ? { axis, scalar: value } : null;
}

/** The curve fields an event already carries, copied so the draft never aliases the chart. */
function anchorCurve(event: {
  easingType?: unknown;
  easingLeft?: unknown;
  easingRight?: unknown;
  bezier?: unknown;
  bezierPoints?: unknown;
}): SamplingCurveDraft {
  const curve: SamplingCurveDraft = {};
  if (typeof event.easingType === "number" && Number.isFinite(event.easingType)) {
    curve.easingType = event.easingType;
  }
  if (typeof event.easingLeft === "number" && Number.isFinite(event.easingLeft)) {
    curve.easingLeft = clamp01(event.easingLeft);
  }
  if (typeof event.easingRight === "number" && Number.isFinite(event.easingRight)) {
    curve.easingRight = clamp01(event.easingRight);
  }
  if (typeof event.bezier === "number" || typeof event.bezier === "boolean") {
    curve.bezier = Boolean(event.bezier);
  }
  if (
    Array.isArray(event.bezierPoints) &&
    event.bezierPoints.length === 4 &&
    event.bezierPoints.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    curve.bezierPoints = [...event.bezierPoints];
  }
  return curve;
}

/**
 * Open the sampling pane for one event's start and end anchors.
 *
 * Returns false when the track has no sampler axis or when the event is
 * missing; every remaining event type with an axis is sampled the same way.
 */
export function startSamplingForEvent(
  session: EditorSession,
  options: StartSamplingEventOptions,
): boolean {
  const axis = samplingAxisForEventType(options.eventType);
  if (!axis) {
    return false;
  }
  const events = eventListAt(session, options.lineIndex, options.eventType, options.eventLayer);
  const event = options.eventId
    ? (events.find((candidate) => candidate.id === options.eventId) ?? events[options.eventIndex])
    : events[options.eventIndex];
  if (!event) {
    return false;
  }
  const target: SamplingTarget = {
    lineIndex: options.lineIndex,
    eventType: options.eventType,
    eventIndex: options.eventIndex,
    ...(options.eventId ? { eventId: options.eventId } : {}),
    eventLayer: options.eventLayer,
    axis,
  };
  const curve = anchorCurve(event);
  const initialStart = anchorValue(event, "start", axis);
  const initialEnd = anchorValue(event, "end", axis);
  samplingSession.set({
    target,
    draft: {
      start: initialStart,
      end: initialEnd,
      curve,
    },
    initialAnchors: { start: initialStart, end: initialEnd },
    easingType: curve.easingType ?? 1,
    locked: false,
    dragging: false,
  });
  if (!openInspector("sampling")) {
    stopSampling();
    return false;
  }
  // Borrow the camera after the pane switch: leaving another pane that borrows it
  // returns that pane's saved view first, so sampling captures the frame the user
  // actually left behind. The chart is centered at that magnification because a
  // sampler reaches both axes from the middle.
  if (!previousCamera) {
    previousCamera = borrowFreeCamera();
    setFreeCameraView(previousCamera.zoom, 0, 0);
  }
  return true;
}

/**
 * Open the sampler for the single selected event.
 *
 * Sampling writes both anchors of one event, so a multi-line or multi-event
 * selection has no unambiguous target; those selections return false and leave
 * the workspace untouched.
 */
export function startSamplingForSelection(session: EditorSession): boolean {
  if (session.multiLineActive) {
    return false;
  }
  const selected = selectedEvents(session);
  if (selected.length !== 1) {
    return false;
  }
  const [entry] = selected;
  return startSamplingForEvent(session, {
    lineIndex: session.lineIndex,
    eventType: entry.type,
    eventIndex: entry.index,
    eventId: entry.event.id,
    eventLayer: session.eventLayer,
  });
}

/** Mark the start of an overlay drag; the draft keeps its last visible anchors. */
export function beginSamplingDrag(): void {
  const current = samplingSession.get();
  if (!current.target || current.dragging) {
    return;
  }
  samplingSession.set({ ...current, dragging: true });
}

/** Replace both visible anchors while a drag or a preset update moves them. */
export function setSamplingDraft(start: SamplingValue | null, end: SamplingValue | null): void {
  const current = samplingSession.get();
  if (!current.target) {
    return;
  }
  samplingSession.set({ ...current, draft: { ...current.draft, start, end } });
}

/** Finish an overlay drag and lock the draft once both anchors exist. */
export function endSamplingDrag(): void {
  const current = samplingSession.get();
  if (!current.target) {
    return;
  }
  samplingSession.set({
    ...current,
    dragging: false,
    locked: Boolean(current.draft.start && current.draft.end),
  });
}

/** Restore the event's original anchors after cancelling the current sample. */
export function cancelSamplingDrag(): void {
  const current = samplingSession.get();
  if (!current.target) {
    return;
  }
  samplingSession.set({
    ...current,
    draft: {
      ...current.draft,
      start: current.initialAnchors.start,
      end: current.initialAnchors.end,
    },
    locked: false,
    dragging: false,
  });
}

/** Merge curve fields into the one draft shared by the pane and the overlay. */
export function setSamplingCurve(patch: SamplingCurveDraft): void {
  const current = samplingSession.get();
  if (!current.target) {
    return;
  }
  const curve: SamplingCurveDraft = { ...current.draft.curve, ...patch };
  if (patch.bezier !== undefined) {
    curve.bezier = Boolean(patch.bezier);
  }
  if (patch.bezierPoints !== undefined) {
    curve.bezierPoints = [...patch.bezierPoints];
  }
  if (patch.easingLeft !== undefined) {
    curve.easingLeft = clamp01(patch.easingLeft);
  }
  if (patch.easingRight !== undefined) {
    curve.easingRight = clamp01(patch.easingRight);
  }
  samplingSession.set({
    ...current,
    draft: { ...current.draft, curve },
    easingType:
      typeof curve.easingType === "number" && Number.isFinite(curve.easingType)
        ? curve.easingType
        : current.easingType,
  });
}

/** Set the preset easing id while keeping every other curve field in the draft. */
export function setSamplingEasing(easingType: number): void {
  setSamplingCurve({ easingType });
}

/** Clear the session and return the camera view the sampler borrowed. */
export function stopSampling(): void {
  const camera = previousCamera;
  previousCamera = null;
  if (!samplingSession.get().target && !camera) {
    return;
  }
  samplingSession.set(EMPTY_SESSION);
  if (camera) {
    releaseFreeCamera(camera);
  }
}

/** Leave sampling and return to the event inspector. */
export function cancelSampling(): void {
  stopSampling();
  openInspector("events");
}

/** Outcome of committing the sampled anchors and curve. */
export interface FinishSamplingResult {
  ok: boolean;
  error?: unknown;
  createdCounterpart?: boolean;
}

/**
 * Commit the draft anchors and curve as one chart edit.
 *
 * A failed commit keeps the session open so the user can retry or cancel.
 */
export function commitSampling(session: EditorSession): FinishSamplingResult {
  const current = samplingSession.get();
  if (!current.target || !current.draft.start || !current.draft.end || current.dragging) {
    return { ok: false };
  }
  try {
    const curve: SamplingCurveDraft = {
      ...current.draft.curve,
      easingType: current.draft.curve.easingType ?? current.easingType,
    };
    const settings = samplingSettings.get();
    const result = applySamplingAnchors(
      session,
      current.target,
      { start: current.draft.start, end: current.draft.end },
      curve,
      { ...settings, xyBinding: samplingXYBindingEnabled(settings) },
    );
    stopSampling();
    openInspector("events");
    return { ok: true, createdCounterpart: result.createdCounterpart };
  } catch (error) {
    return { ok: false, error };
  }
}
