/**
 * Decides which inspector pane the current selection should activate and reports
 * whether that decision changed. It reads editor state without applying effects;
 * the command layer owns the resulting UI calls.
 */
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import { eventLayerOf } from "../../../../../../core/edit/timeline/model.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** The Inspector-facing result of reconciling editor selection with the active pane. */
export type SelectionPaneAction =
  | {
      kind: "none" | "sync-multi" | "activate-trajectory" | "activate-curve" | "close";
    }
  | { kind: "open-multi"; focus: "notes" | "events" }
  | { kind: "open-trajectory"; event: JudgeLineEvent; lineIndex: number; layer: number }
  | { kind: "activate-pane"; name: "notes" | "events" };

/** The decision and signature produced by one routing pass. */
export interface SelectionPaneResult {
  signature: string;
  selectionCount: number;
  action: SelectionPaneAction;
}

/** Current Inspector and selection state the router reads. */
export interface SelectionPaneState {
  activePane: string;
  multiEditCommitting: boolean;
  trajectoryActive: boolean;
  curveEditorOpen: boolean;
  /** True when the selection change came from a direct pointer gesture. */
  pointerSelection: boolean;
  /** True before the router has observed the first published editor state. */
  initialRoute: boolean;
  /** True when the active judge line changed without a new object selection. */
  lineChanged: boolean;
}

/** Serializes one multi-line selection for change detection. */
function multiSelectionSignature<T>(
  selection: ReadonlyMap<number, ReadonlySet<T>>,
  sort: (a: T, b: T) => number,
): string {
  return [...selection]
    .map(([line, values]) => `${line}:${[...values].sort(sort).join(",")}`)
    .sort()
    .join("|");
}

/** Stable signature of every value that can change the Inspector routing decision. */
export function selectionPaneSignature(session: EditorSession, eventLayerIndex: number): string {
  const multiEvents = multiSelectionSignature(session.multiEventSelection ?? new Map(), (a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
  const multiNotes = multiSelectionSignature(
    session.multiLineSelection ?? new Map(),
    (a, b) => Number(a) - Number(b),
  );
  return `${session.lineIndex}:${eventLayerIndex}|${session.focus}|${session.marqueeSelection}|${session.selectionMode}|${session.selectionRevision}|${[...session.selection].sort((a, b) => a - b).join(",")}|${[...session.eventSelection].sort().join(",")}|${multiNotes}|${multiEvents}`;
}

/** Number of selected objects in the session's current focus. */
function selectionCount(session: EditorSession): number {
  if (session.focus === "events") {
    return session.multiLineActive && session.multiLineMode === "events"
      ? Math.max(
          session.eventSelection.size,
          [...(session.multiEventSelection ?? new Map()).values()].reduce(
            (total, values) => total + values.size,
            0,
          ),
        )
      : session.eventSelection.size;
  }
  return session.multiLineActive && session.multiLineMode === "notes"
    ? [...(session.multiLineSelection ?? new Map()).values()].reduce(
        (total, values) => total + values.size,
        0,
      )
    : session.selection.size;
}

/** Resolves Inspector routing without mutating the editor session or the DOM. */
export function resolveSelectionPane(
  session: EditorSession,
  layer: number,
  state: SelectionPaneState,
): SelectionPaneResult {
  const count = selectionCount(session);
  let action: SelectionPaneAction = { kind: "none" };
  const curvePane = state.activePane === "curve-preview" || state.activePane === "curve";
  const pointerSelection = state.pointerSelection || session.marqueeSelection === session.focus;
  if (curvePane && !(pointerSelection && count > 0)) {
    // Curve authoring keeps its inspector through anchor picking and stray
    // clicks; a pointer selection of real objects still replaces it.
    action = { kind: "none" };
  } else if (state.multiEditCommitting) {
    action = { kind: "sync-multi" };
  } else if (
    state.trajectoryActive &&
    count !== 1 &&
    !(count > 0 && session.marqueeSelection === session.focus)
  ) {
    action = { kind: "activate-trajectory" };
  } else if (state.curveEditorOpen && !pointerSelection) {
    action = { kind: "activate-curve" };
  } else if (count > 0 && session.selectionMode === "multi") {
    action = { kind: "open-multi", focus: session.focus === "events" ? "events" : "notes" };
  } else if (count === 1) {
    const entries =
      session.multiLineActive && session.multiLineMode === "events"
        ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) =>
            [...keys].map((key) => ({ lineIndex, key })),
          )
        : [...session.eventSelection].map((key) => ({ lineIndex: session.lineIndex, key }));
    const selected = entries.length === 1 ? entries[0] : null;
    const [type, index] = selected?.key.split(":") ?? [];
    const line = selected ? session.chart.judgeLineList?.[selected.lineIndex] : undefined;
    const event = eventLayerOf(line?.eventLayers?.[layer])[type ?? ""]?.[Number(index)];
    action =
      session.focus === "events" && selected && event?.trajectory
        ? { kind: "open-trajectory", event, lineIndex: selected.lineIndex, layer }
        : { kind: "activate-pane", name: session.focus === "events" ? "events" : "notes" };
  } else if (!state.initialRoute && !state.lineChanged && state.activePane !== "multi-line") {
    action = { kind: "close" };
  }
  return { signature: selectionPaneSignature(session, layer), selectionCount: count, action };
}
