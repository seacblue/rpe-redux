/** Owns event-track value families and the batch-edit compatibility rules. */
import { EVENT_TRACKS } from "../../global/chart/chartVocabulary.ts";
import { NOISE_ACTIVE_EVENTS } from "../events/eventTracks.ts";

/** The value shape shared by an event track's start and end endpoints. */
export type EventValueFamily = "number" | "rgb" | "text" | "shader";

/** Fields that operate on every event family without reading its endpoint value. */
export const EVENT_COMMON_FIELDS = ["easing", "t1", "t2", "line", "linkgroup"] as const;

/** Numeric endpoint fields available to ordinary number-valued event tracks. */
export const EVENT_NUMBER_FIELDS = ["both", "start", "end"] as const;

/** Individual colour channels available to RGB event tracks. */
export const EVENT_RGB_FIELDS = ["red", "green", "blue"] as const;

export type EventBatchField =
  | (typeof EVENT_COMMON_FIELDS)[number]
  | (typeof EVENT_NUMBER_FIELDS)[number]
  | (typeof EVENT_RGB_FIELDS)[number];

/** Return the value family owned by one stored event track, or null when it is synthetic. */
export function eventValueFamily(type: string): EventValueFamily | null {
  if (!(EVENT_TRACKS as readonly string[]).includes(type) || type === NOISE_ACTIVE_EVENTS) {
    return null;
  }
  if (type === "colorEvents") {
    return "rgb";
  }
  if (type === "textEvents") {
    return "text";
  }
  if (type === "paintEvents") {
    return "shader";
  }
  return "number";
}

/** Return the first compatible family in a target list, or null for empty/mixed input. */
export function eventFamilyForTypes(types: readonly string[]): EventValueFamily | null {
  let family: EventValueFamily | null = null;
  for (const type of types) {
    const next = eventValueFamily(type);
    if (!next) {
      return null;
    }
    if (family && family !== next) {
      return null;
    }
    family = next;
  }
  return family;
}

/** Whether a candidate can be added to the current same-family target list. */
export function canSelectEventType(selectedTypes: readonly string[], candidate: string): boolean {
  const candidateFamily = eventValueFamily(candidate);
  if (!candidateFamily) {
    return false;
  }
  const selectedFamily = eventFamilyForTypes(selectedTypes);
  return selectedFamily === null || selectedFamily === candidateFamily;
}

/** De-duplicate and return eligible event tracks in the stable chart vocabulary order. */
export function eventTypesForSelection(types: readonly string[]): string[] {
  const present = new Set(types);
  return EVENT_TRACKS.filter((type) => present.has(type));
}

/** Return fields valid for a selected event value family. */
export function eventFieldsForFamily(family: EventValueFamily | null): readonly EventBatchField[] {
  if (family === "number") {
    return [...EVENT_NUMBER_FIELDS, ...EVENT_COMMON_FIELDS];
  }
  if (family === "rgb") {
    return [...EVENT_RGB_FIELDS, ...EVENT_COMMON_FIELDS];
  }
  if (family === "text" || family === "shader") {
    return [...EVENT_COMMON_FIELDS];
  }
  return [];
}

/** Whether a batch field is legal for a selected event family. */
export function isEventFieldAllowed(
  field: string,
  family: EventValueFamily | null,
): field is EventBatchField {
  return eventFieldsForFamily(family).includes(field as EventBatchField);
}

/** The first safe field for a family when a persisted draft has no compatible field. */
export function defaultEventFieldForFamily(
  family: EventValueFamily | null,
): EventBatchField | null {
  if (family === "number") {
    return "both";
  }
  if (family === "rgb" || family === "text" || family === "shader") {
    return "t1";
  }
  return null;
}
