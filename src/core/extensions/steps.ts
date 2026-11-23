/** Declarative extension steps: planning and applying a bounded, host-owned recipe vocabulary. */
import {
  assertChart,
  normalizeChartObjectIds,
  EVENT_TYPES,
  EXTENDED_TYPES,
  type Chart,
} from "../global/chart/chart.ts";
import { isChartObjectId, type ChartObjectId } from "../global/chart/identity.ts";
import { eventKey, eventListAt } from "../edit/events/eventTracks.ts";
import {
  applyRequest,
  fingerprint,
  transactionChart,
  type MutableTransactionState,
} from "../edit/transaction/service.ts";
import {
  isChartTransactionRequest,
  type ChartTransactionRequest,
  type TransactionIssue,
} from "../edit/transaction/contract.ts";
import { collectChartObjectIds } from "../edit/transaction/locations.ts";
import { commitSelectionEdit, type SelectionEditResult } from "../edit/selection/edits.ts";
import { captureSelection, type SelectionSnapshot } from "../edit/selection/snapshot.ts";
import type { EditorFocus, EditorSession } from "../edit/session/session.ts";
import type { HistoryEntryMetadata } from "../edit/session/history.ts";
import { previewMultiEdit } from "../edit/multiEdit/plan.ts";
import type { MultiEditKind } from "../edit/multiEdit/parameters.ts";
import type { BatchEditOptions, MultiEditResult } from "../edit/multiEdit/planVocabulary.ts";
import type { ExtensionText } from "./i18n.ts";
import type { ParamValue } from "./scriptUi.ts";
import { isRecord } from "../utils/guards.ts";

/** A parameter reference is resolved to a validated script parameter, never evaluated as code. */
export interface StepParameterReference {
  readonly expression: string;
}

/** A more explicit spelling accepted for the same parameter-only reference. */
export interface StepNamedParameterReference {
  readonly parameter: string;
}

/** A nested object of step values. */
export interface StepRecord {
  readonly [key: string]: StepValue;
}

/** A literal or parameter reference; arrays and records recurse. */
export type StepValue =
  | string
  | number
  | boolean
  | StepParameterReference
  | StepNamedParameterReference
  | readonly StepValue[]
  | StepRecord;

/** Preview one multi-edit batch against the current step selection. */
export interface BatchStep {
  readonly op: "batch";
  readonly kind: MultiEditKind;
  readonly parameters?: Readonly<Record<string, StepValue>>;
  readonly options?: Readonly<Record<string, StepValue>>;
}

/** Apply one validated chart transaction request. */
export interface TransactionStep {
  readonly op: "transaction";
  /** A declarative request may contain parameter references at any leaf. */
  readonly request: ChartTransactionRequest | StepRecord;
}

/** Choose the selection the next mutating step uses. */
export interface SelectStep {
  readonly op: "select";
  readonly target: "original" | "changed";
}

/** Emit one localized notice when the plan is applied. */
export interface NoticeStep {
  readonly op: "notice";
  readonly message: ExtensionText;
}

/** The complete v1 operation vocabulary; there is deliberately no arbitrary code step. */
export type ExtensionScriptStep = BatchStep | TransactionStep | SelectStep | NoticeStep;

/** The detached chart and affected ids after one step completed. */
export interface StepIntermediateState {
  readonly index: number;
  readonly op: ExtensionScriptStep["op"];
  readonly chart: Chart;
  readonly affectedObjectIds: readonly ChartObjectId[];
}

/** One fully evaluated recipe, ready to commit against the fingerprint it started from. */
export interface StepsPlan {
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
  readonly chart: Chart;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly changedObjectIds: readonly ChartObjectId[];
  readonly currentObjectIds: readonly ChartObjectId[];
  readonly focus: EditorFocus;
  readonly lineIndex: number;
  readonly eventLayer: number;
  readonly notices: readonly ExtensionText[];
  readonly intermediate: readonly StepIntermediateState[];
}

/** A plan, or the reason planning failed. */
export type StepsPlanResult =
  | { readonly ok: true; readonly plan: StepsPlan }
  | { readonly ok: false; readonly reason: string; readonly issues?: readonly TransactionIssue[] };

/** Whether a plan was committed, made no change, or was rejected. */
export type StepsApplyResult =
  | { readonly status: "committed"; readonly plan: StepsPlan }
  | { readonly status: "unchanged"; readonly plan: StepsPlan }
  | { readonly status: "rejected"; readonly reason: string; readonly plan: StepsPlan };

/** Plan-and-apply options for one script invocation. */
export interface RunStepsOptions {
  readonly params?: Readonly<Record<string, ParamValue>>;
  readonly label?: string;
  readonly metadata?: HistoryEntryMetadata;
  readonly onNotice?: (message: ExtensionText) => void;
}

export type RunStepsResult =
  | { readonly ok: true; readonly status: "committed" | "unchanged"; readonly plan: StepsPlan }
  | { readonly ok: false; readonly reason: string; readonly plan?: StepsPlan };

interface StepState {
  chart: Chart;
  readonly originalObjectIds: Set<ChartObjectId>;
  currentObjectIds: Set<ChartObjectId>;
  changedObjectIds: Set<ChartObjectId>;
  affectedObjectIds: Set<ChartObjectId>;
  focus: EditorFocus;
  lineIndex: number;
  eventLayer: number;
  shaderAutoAlign?: boolean;
  readonly notices: ExtensionText[];
  readonly intermediate: StepIntermediateState[];
}

interface LocatedEvent {
  readonly id: ChartObjectId;
  readonly type: string;
  readonly index: number;
  readonly lineIndex: number;
}

/** Resolve a parameter reference, rejecting names the caller did not supply. */
function parameterValue(
  reference: StepParameterReference | StepNamedParameterReference,
  params: Readonly<Record<string, ParamValue>>,
): ParamValue {
  const name = "expression" in reference ? reference.expression : reference.parameter;
  if (!name || !Object.hasOwn(params, name)) {
    throw new Error(`Unknown step parameter: ${name || "<empty>"}`);
  }
  return params[name];
}

/** Recursively replace single-key parameter references with their values. */
function resolveValue(value: unknown, params: Readonly<Record<string, ParamValue>>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, params));
  }
  if (!isRecord(value)) {
    return value;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "expression" && typeof value.expression === "string") {
    return parameterValue(value as unknown as StepParameterReference, params);
  }
  if (keys.length === 1 && keys[0] === "parameter" && typeof value.parameter === "string") {
    return parameterValue(value as unknown as StepNamedParameterReference, params);
  }
  return Object.fromEntries(keys.map((key) => [key, resolveValue(value[key], params)]));
}

/** Flatten a transaction issue into one diagnostic message. */
function issueReason(issue: TransactionIssue): string {
  return [issue.code, issue.path, issue.message].filter(Boolean).join(": ");
}

/** Add only values that are valid chart object ids. */
function addIds(target: Set<ChartObjectId>, values: Iterable<unknown>): void {
  for (const value of values) {
    if (isChartObjectId(value)) {
      target.add(value);
    }
  }
}

/** Capture the note and event ids selected before planning began. */
function originalObjectIds(session: EditorSession): Set<ChartObjectId> {
  const snapshot = captureSelection(session);
  const ids = new Set<ChartObjectId>();
  addIds(
    ids,
    snapshot.notes.map((entry) => entry.note.id),
  );
  addIds(
    ids,
    snapshot.events.map((entry) => entry.event.id),
  );
  return ids;
}

/** Locate the given event ids by line, type, and index. */
function eventLocations(
  chart: Chart,
  ids: ReadonlySet<ChartObjectId>,
  eventLayer: number,
): LocatedEvent[] {
  const found: LocatedEvent[] = [];
  const types = [...EVENT_TYPES, ...EXTENDED_TYPES];
  for (const [lineIndex] of (chart.judgeLineList ?? []).entries()) {
    for (const type of types) {
      const events = eventListAt({ chart, lineIndex, eventLayer }, lineIndex, type, eventLayer);
      for (const [index, event] of events.entries()) {
        if (isChartObjectId(event.id) && ids.has(event.id)) {
          found.push({ id: event.id, type, index, lineIndex });
        }
      }
    }
  }
  return found;
}

/** Build the selection snapshot for the current ids in the requested layer. */
function snapshotFor(state: StepState, kind: MultiEditKind): SelectionSnapshot {
  const notes = (state.chart.judgeLineList ?? []).flatMap((line, lineIndex) =>
    (line.notes ?? []).flatMap((note, index) =>
      isChartObjectId(note.id) && state.currentObjectIds.has(note.id)
        ? [{ lineIndex, index, note }]
        : [],
    ),
  );
  const events = eventLocations(state.chart, state.currentObjectIds, state.eventLayer).map(
    ({ type, index, lineIndex, id }) => ({
      type,
      index,
      lineIndex,
      event: eventListAt(
        { chart: state.chart, lineIndex, eventLayer: state.eventLayer },
        lineIndex,
        type,
        state.eventLayer,
      )[index],
      id,
    }),
  );
  return {
    chart: state.chart,
    lineIndex: state.lineIndex,
    eventLayer: state.eventLayer,
    focus: kind,
    shaderAutoAlign: state.shaderAutoAlign,
    notes: kind === "notes" ? notes : [],
    events: kind === "events" ? events : [],
  };
}

/** Split changed ids into pre-edit ids and ids that still exist afterwards. */
function objectIdsFromBatch(
  result: MultiEditResult,
  chart: Chart,
): { before: Set<ChartObjectId>; after: Set<ChartObjectId> } {
  const before = new Set<ChartObjectId>();
  const after = new Set<ChartObjectId>();
  for (const change of result.changes) {
    if (isChartObjectId(change.before.id)) {
      before.add(change.before.id);
    }
    if (isChartObjectId(change.after.id)) {
      after.add(change.after.id);
    }
  }
  const existing = collectChartObjectIds(chart);
  return {
    before,
    after: new Set([...after].filter((id) => existing.has(id))),
  };
}

/** Apply one batch step to the detached chart and carry its ids forward. */
function planBatch(
  state: StepState,
  step: BatchStep,
  params: Readonly<Record<string, ParamValue>>,
): void {
  const parameters = resolveValue(step.parameters ?? {}, params);
  const options = resolveValue(step.options ?? {}, params);
  const plannerOptions = { ...(parameters as object), ...(options as object) } as BatchEditOptions;
  const result = previewMultiEdit(snapshotFor(state, step.kind), step.kind, plannerOptions);
  normalizeChartObjectIds(result.chart);
  assertChart(result.chart);
  const ids = objectIdsFromBatch(result, result.chart);
  addIds(state.affectedObjectIds, ids.before);
  addIds(state.affectedObjectIds, ids.after);
  state.chart = result.chart;
  state.changedObjectIds = ids.after;
  state.currentObjectIds = new Set(ids.after);
  state.focus = step.kind;
}

/** Apply one transaction step to the detached chart, keeping surviving ids. */
function planTransaction(
  state: StepState,
  step: TransactionStep,
  params: Readonly<Record<string, ParamValue>>,
): void {
  const request = resolveValue(step.request, params);
  if (!isChartTransactionRequest(request)) {
    throw new Error("Step transaction request must be an object");
  }
  const chart = transactionChart(state.chart);
  const transactionState: MutableTransactionState = {
    chart,
    issues: [],
    affected: [],
    usedIds: collectChartObjectIds(chart),
    relationTouched: new Set(),
    clonedLines: new Set(),
  };
  applyRequest(transactionState, request);
  if (transactionState.issues.length) {
    throw new Error(issueReason(transactionState.issues[0]));
  }
  normalizeChartObjectIds(chart);
  assertChart(chart);
  addIds(state.affectedObjectIds, transactionState.affected);
  state.chart = chart;
  state.changedObjectIds = new Set(
    transactionState.affected.filter((id) => collectChartObjectIds(chart).has(id)),
  );
  state.currentObjectIds = new Set(
    [...state.currentObjectIds].filter((id) => collectChartObjectIds(chart).has(id)),
  );
}

/** Record an immutable chart snapshot after one completed step. */
function rememberIntermediate(
  state: StepState,
  index: number,
  op: ExtensionScriptStep["op"],
): void {
  state.intermediate.push({
    index,
    op,
    chart: structuredClone(state.chart),
    affectedObjectIds: Object.freeze([...state.affectedObjectIds]),
  });
}

function isStep(value: unknown): value is ExtensionScriptStep {
  return Boolean(isRecord(value) && typeof value.op === "string");
}

/**
 * Plan every step against a detached chart. `select(original)` restores the
 * ids captured before the recipe; `select(changed)` selects ids affected by
 * the most recent mutating step. In both cases the choice controls the next
 * batch's scope, and never mutates the live editor selection during planning.
 */
export function planSteps(
  session: EditorSession | null,
  steps: readonly ExtensionScriptStep[],
  params: Readonly<Record<string, ParamValue>> = {},
): StepsPlanResult {
  if (!session) {
    return { ok: false, reason: "Editor runtime is unavailable" };
  }
  if (session.readOnly) {
    return { ok: false, reason: "Editor is read-only" };
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: "Steps must not be empty" };
  }
  const beforeFingerprint = fingerprint(session.chart);
  try {
    const chart = structuredClone(session.chart) as Chart;
    normalizeChartObjectIds(chart);
    const originalIds = originalObjectIds(session);
    const state: StepState = {
      chart,
      originalObjectIds: originalIds,
      currentObjectIds: new Set(originalIds),
      changedObjectIds: new Set(),
      affectedObjectIds: new Set(),
      focus: session.focus,
      lineIndex: session.lineIndex,
      eventLayer: session.eventLayer,
      shaderAutoAlign: session.shaderAutoAlign,
      notices: [],
      intermediate: [],
    };
    for (const [index, rawStep] of steps.entries()) {
      if (!isStep(rawStep)) {
        throw new Error(`Invalid step at index ${index}`);
      }
      switch (rawStep.op) {
        case "batch":
          if (rawStep.kind !== "notes" && rawStep.kind !== "events") {
            throw new Error(`Invalid batch kind at index ${index}`);
          }
          planBatch(state, rawStep, params);
          break;
        case "transaction":
          planTransaction(state, rawStep, params);
          break;
        case "select":
          if (rawStep.target === "original") {
            state.currentObjectIds = new Set(state.originalObjectIds);
          } else if (rawStep.target === "changed") {
            state.currentObjectIds = new Set(state.changedObjectIds);
          } else {
            throw new Error(`Invalid select target at index ${index}`);
          }
          break;
        case "notice":
          if (
            typeof rawStep.message !== "string" &&
            !(isRecord(rawStep.message) && typeof rawStep.message.key === "string")
          ) {
            throw new Error(`Invalid notice message at index ${index}`);
          }
          state.notices.push(rawStep.message);
          break;
        default:
          throw new Error(`Unsupported step operation at index ${index}`);
      }
      rememberIntermediate(state, index, rawStep.op);
    }
    assertChart(state.chart);
    const afterFingerprint = fingerprint(state.chart);
    const plan: StepsPlan = Object.freeze({
      beforeFingerprint,
      afterFingerprint,
      chart: state.chart,
      affectedObjectIds: Object.freeze([...state.affectedObjectIds]),
      changedObjectIds: Object.freeze([...state.changedObjectIds]),
      currentObjectIds: Object.freeze([...state.currentObjectIds]),
      focus: state.focus,
      lineIndex: state.lineIndex,
      eventLayer: state.eventLayer,
      notices: Object.freeze([...state.notices]),
      intermediate: Object.freeze([...state.intermediate]),
    });
    return { ok: true, plan };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Convert the plan's current ids into the selection edit applied on commit. */
function selectionResultForPlan(plan: StepsPlan): SelectionEditResult {
  const noteEntries = (plan.chart.judgeLineList ?? []).flatMap((line, lineIndex) =>
    (line.notes ?? []).flatMap((note, index) =>
      isChartObjectId(note.id) && plan.currentObjectIds.includes(note.id)
        ? [{ lineIndex, index }]
        : [],
    ),
  );
  const eventEntries = eventLocations(plan.chart, new Set(plan.currentObjectIds), plan.eventLayer);
  const selection = new Set(
    noteEntries.filter((entry) => entry.lineIndex === plan.lineIndex).map((entry) => entry.index),
  );
  const eventSelection = new Set(
    eventEntries
      .filter((entry) => entry.lineIndex === plan.lineIndex)
      .map((entry) => eventKey(entry.type, entry.index)),
  );
  const multiLineSelection = new Map<number, Set<number>>();
  for (const entry of noteEntries) {
    if (!multiLineSelection.has(entry.lineIndex)) {
      multiLineSelection.set(entry.lineIndex, new Set());
    }
    multiLineSelection.get(entry.lineIndex)?.add(entry.index);
  }
  const multiEventSelection = new Map<number, Set<string>>();
  for (const entry of eventEntries) {
    if (!multiEventSelection.has(entry.lineIndex)) {
      multiEventSelection.set(entry.lineIndex, new Set());
    }
    multiEventSelection.get(entry.lineIndex)?.add(eventKey(entry.type, entry.index));
  }
  return {
    chart: plan.chart,
    lineIndex: plan.lineIndex,
    eventLayer: plan.eventLayer,
    focus: plan.focus,
    selection,
    eventSelection,
    ...(multiLineSelection.size > 1 ? { multiLineSelection } : {}),
    ...(multiEventSelection.size > 1 ? { multiEventSelection } : {}),
  };
}

/** Consume a plan once. The fingerprint guard makes dry-run and apply share one exact plan. */
export function applySteps(
  session: EditorSession,
  plan: StepsPlan,
  label: string,
  metadata: HistoryEntryMetadata = {},
): StepsApplyResult {
  if (fingerprint(session.chart) !== plan.beforeFingerprint) {
    return { status: "rejected", reason: "Step plan is stale", plan };
  }
  if (plan.afterFingerprint === plan.beforeFingerprint) {
    return { status: "unchanged", plan };
  }
  const committed = commitSelectionEdit(session, selectionResultForPlan(plan), label, {
    ...metadata,
    affectedObjectIds: plan.affectedObjectIds,
  });
  return committed
    ? { status: "committed", plan }
    : { status: "rejected", reason: "Step plan could not be committed", plan };
}

/** Convenience path used by scripts; callers that need dry-run retain the returned plan. */
export function runSteps(
  session: EditorSession | null,
  steps: readonly ExtensionScriptStep[],
  options: RunStepsOptions = {},
): RunStepsResult {
  const planned = planSteps(session, steps, options.params);
  if (!planned.ok) {
    return planned;
  }
  const result = applySteps(
    session as EditorSession,
    planned.plan,
    options.label ?? "Extension steps",
    options.metadata,
  );
  if (result.status === "rejected") {
    return { ok: false, reason: result.reason, plan: result.plan };
  }
  for (const notice of planned.plan.notices) {
    options.onNotice?.(notice);
  }
  return { ok: true, status: result.status, plan: result.plan };
}
