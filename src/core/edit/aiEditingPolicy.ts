/**
 * Field-level AI write policy for optional chart data.
 *
 * A Code Cell client can only touch an advanced field while its AI
 * permission is on. The check lives here rather than in the transaction kernel
 * so a human edit, an extension, and an AI client keep the same transaction
 * grammar; only the AI entry points add this policy.
 */
import { EXTENDED_TYPES } from "../global/chart/chart.ts";
import type { ChartObjectId } from "../global/chart/identity.ts";
import type { EditingFeature } from "../settings/editingFeatureKeys.ts";
import { aiEditingFeatureStates } from "../settings/editingAiAccess.ts";
import { isRecord } from "../utils/guards.ts";
import type { TransactionIssue } from "./transaction/contract.ts";
import { findEvent } from "./transaction/locations.ts";

/** The part of a chart this policy reads: event ownership and layer. */
export interface AiPolicyChart {
  readonly judgeLineList?: readonly unknown[];
}

/** Chart fields gated by the note property switches. */
const NOTE_FIELD_FEATURES: Readonly<Record<string, EditingFeature>> = Object.freeze({
  speed: "noteSpeed",
  yOffset: "noteYOffset",
  visibleTime: "noteVisibleTime",
  isFake: "fakeNotes",
  size: "noteSize",
  alpha: "noteAlpha",
  color: "noteColor",
  tint: "noteColor",
  hitSound: "noteHitSound",
  hitsound: "noteHitSound",
});

/** Event fields gated by the event property switches. */
const EVENT_FIELD_FEATURES: Readonly<Record<string, EditingFeature>> = Object.freeze({
  linkgroup: "linkgroup",
  easingLeft: "easingRange",
  easingRight: "easingRange",
  bezier: "bezier",
  bezierPoints: "bezier",
});

/** Judge-line fields gated by the line property switches. */
const LINE_FIELD_FEATURES: Readonly<Record<string, EditingFeature>> = Object.freeze({
  bpmfactor: "lineBpmFactor",
  father: "parentLines",
  parentId: "parentLines",
  rotateWithFather: "parentLines",
  isCover: "lineExtended",
  zOrder: "lineExtended",
  isGif: "lineExtended",
  attachUI: "lineExtended",
  anchor: "lineAnchor",
});

/** Stable issue for one restricted write. The message stays deliberately broad. */
function restricted(path: string): TransactionIssue {
  return Object.freeze({
    code: "ai.feature.restricted",
    path,
    message: "This field is restricted by the user's AI access settings",
  });
}

/** Append one issue for every gated field present on an object. */
function checkFields(
  value: unknown,
  features: Readonly<Record<string, EditingFeature>>,
  path: string,
  allowed: Readonly<Record<EditingFeature, boolean>>,
  issues: TransactionIssue[],
): void {
  if (!isRecord(value)) {
    return;
  }
  for (const [field, feature] of Object.entries(features)) {
    if (Object.hasOwn(value, field) && !allowed[feature]) {
      issues.push(restricted(`${path}.${field}`));
    }
  }
}

/** True when the track is stored under `line.extended`. */
function isExtendedTrack(eventType: string): boolean {
  return (EXTENDED_TYPES as readonly string[]).includes(eventType);
}

/** Append issues for an event that already lives on a gated track. */
function checkExistingEvent(
  chart: AiPolicyChart | null | undefined,
  id: unknown,
  path: string,
  allowed: Readonly<Record<EditingFeature, boolean>>,
  issues: TransactionIssue[],
): void {
  if (chart === undefined) {
    issues.push(policyUnavailable(path));
    return;
  }
  if (!chart || typeof id !== "string" || !id) {
    return;
  }
  const located = findEvent(chart, id as ChartObjectId);
  if (!located) {
    return;
  }
  if (
    (typeof located.track === "string" && isExtendedTrack(located.track)) ||
    located.layerIndex === -1
  ) {
    if (!allowed.extendedEvents) {
      issues.push(restricted(path));
    }
    return;
  }
  if (typeof located.layerIndex === "number" && located.layerIndex > 0) {
    if (!allowed.eventLayers) {
      issues.push(restricted(path));
    }
  }
}

/** Append issues for an event being inserted on a gated track or layer. */
function checkInsertedEvent(
  entry: Record<string, unknown>,
  path: string,
  allowed: Readonly<Record<EditingFeature, boolean>>,
  issues: TransactionIssue[],
): void {
  const eventType = entry.eventType;
  if (typeof eventType === "string" && isExtendedTrack(eventType) && !allowed.extendedEvents) {
    issues.push(restricted(`${path}.eventType`));
  }
  const layer = entry.layer;
  if (layer === "extended" && !allowed.extendedEvents) {
    issues.push(restricted(`${path}.layer`));
  } else if (typeof layer === "number" && layer > 0 && !allowed.eventLayers) {
    issues.push(restricted(`${path}.layer`));
  }
}

/** Read an optional operation array without validating its shape. */
function operations(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Stable issue for a policy check that cannot read the current chart. */
function policyUnavailable(path?: string): TransactionIssue {
  return Object.freeze({
    code: "ai.policy.unavailable",
    ...(path ? { path } : {}),
    message: "The AI editing policy could not read the current chart",
  });
}

/**
 * Collect every AI permission issue in one transaction request.
 *
 * `chart` is only needed to resolve the track of an event addressed by id.
 * `null` means no chart is mounted, leaving normal transaction validation to
 * report an unknown id. `undefined` means the snapshot failed: an event
 * update/delete then fails closed because its layer cannot be verified.
 */
export function aiTransactionIssues(
  request: unknown,
  chart: AiPolicyChart | null | undefined,
): readonly TransactionIssue[] {
  if (!isRecord(request)) {
    return Object.freeze([]);
  }
  const allowed = aiEditingFeatureStates();
  const issues: TransactionIssue[] = [];

  if (isRecord(request.lines)) {
    for (const [index, entry] of operations(request.lines.insert).entries()) {
      if (isRecord(entry)) {
        checkFields(
          entry.line,
          LINE_FIELD_FEATURES,
          `lines.insert[${index}].line`,
          allowed,
          issues,
        );
      }
    }
    for (const [index, entry] of operations(request.lines.update).entries()) {
      if (isRecord(entry)) {
        checkFields(
          entry.patch,
          LINE_FIELD_FEATURES,
          `lines.update[${index}].patch`,
          allowed,
          issues,
        );
      }
    }
  }

  if (isRecord(request.notes)) {
    for (const [index, entry] of operations(request.notes.insert).entries()) {
      if (isRecord(entry)) {
        checkFields(
          entry.note,
          NOTE_FIELD_FEATURES,
          `notes.insert[${index}].note`,
          allowed,
          issues,
        );
      }
    }
    for (const [index, entry] of operations(request.notes.update).entries()) {
      if (isRecord(entry)) {
        checkFields(
          entry.patch,
          NOTE_FIELD_FEATURES,
          `notes.update[${index}].patch`,
          allowed,
          issues,
        );
      }
    }
  }

  if (isRecord(request.events)) {
    for (const [index, entry] of operations(request.events.insert).entries()) {
      if (!isRecord(entry)) {
        continue;
      }
      const path = `events.insert[${index}]`;
      checkInsertedEvent(entry, path, allowed, issues);
      checkFields(entry.event, EVENT_FIELD_FEATURES, `${path}.event`, allowed, issues);
    }
    for (const [index, entry] of operations(request.events.update).entries()) {
      if (!isRecord(entry)) {
        continue;
      }
      const path = `events.update[${index}]`;
      checkExistingEvent(chart, entry.id, `${path}.id`, allowed, issues);
      checkFields(entry.patch, EVENT_FIELD_FEATURES, `${path}.patch`, allowed, issues);
    }
    for (const [index, id] of operations(request.events.delete).entries()) {
      checkExistingEvent(chart, id, `events.delete[${index}]`, allowed, issues);
    }
  }

  return Object.freeze(issues);
}
