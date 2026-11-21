/**
 * Pure helpers shared by the multi-edit panel: recipe names, selected tracks,
 * note paint order, and the object ids a commit actually changed.
 *
 * Keeping them outside the panel model leaves the model responsible for the
 * form lifecycle, preview, and commit, and gives the pure id/selection rules a
 * small surface that panel tests can read without a DOM.
 */
import { eventList } from "../../../../../core/edit/events/eventTracks.ts";
import { captureSelection } from "../../../../../core/edit/selection/snapshot.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { EventChain } from "../../../../../core/edit/timeline/eventChains.ts";
import {
  normalizeChartObjectIds,
  type Chart,
  type JudgeLineEvent,
} from "../../../../../core/global/chart/chart.ts";
import { isChartObjectId, type ChartObjectId } from "../../../../../core/global/chart/identity.ts";
import type { CloneParameters } from "../../../../../core/edit/multiEdit/parameters.ts";
import type {
  BatchChange,
  MultiEditResult,
} from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import { t, tRaw } from "../../../../../i18n/index.ts";
import type { MultiEditFormValues } from "./MultiEditForm.tsx";
import { notePaintLayer } from "../../canvas/noteSpriteGroups.ts";

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  By: "editor.commands.multiEdit.operation.by",
  To: "editor.commands.multiEdit.operation.to",
  Times: "editor.commands.multiEdit.operation.times",
  Max: "editor.commands.multiEdit.operation.max",
  Min: "editor.commands.multiEdit.operation.min",
  Flip: "editor.commands.multiEdit.operation.flip",
};

/** Localized recipe name for the active mode. */
export function recipeName(values: MultiEditFormValues | CloneParameters): string {
  if (values.mode === "clone") {
    return t("editorPanels.multiEdit.clone.recipe");
  }
  return tRaw(
    OPERATION_LABELS[values.operation] ?? "editor.commands.multiEdit.error.unknownOperation",
  );
}

/** Compares two batch items by their serialized form. */
function sameBatchItem(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Returns the distinct event tracks represented by the current selection. */
export function selectedEventTypes(session: EditorSession): string[] {
  return [...new Set(captureSelection(session).events.map((entry) => entry.type))];
}

/** Paint layer of one planned note edit; the item may omit its type. */
export function batchPaintLayer(change: BatchChange): number {
  return notePaintLayer(typeof change.after.type === "number" ? change.after.type : 1);
}

/** Finds the chart line that currently owns a note or event object. */
export function sourceLineIndex(session: EditorSession, item: object): number | undefined {
  const index = (session.chart.judgeLineList ?? []).findIndex((line) => {
    if ((line.notes ?? []).some((note) => note === item)) {
      return true;
    }
    return [...(line.eventLayers ?? []), line.extended].some((layer) =>
      Object.values(layer ?? {}).some(
        (events) => Array.isArray(events) && events.some((event) => event === item),
      ),
    );
  });
  return index >= 0 ? index : undefined;
}

/** The cache surface the ghost range resolver reads. */
export interface EventDisplaySource {
  eventDisplay(
    chart: Chart,
    events: readonly JudgeLineEvent[],
  ): { ranges: Map<number, EventChain<JudgeLineEvent>> };
}

/**
 * Resolve every preview change against the result chart's own event chains.
 *
 * The chain min/max must include the unchanged events too, or a ghost curve
 * spans only its own start/end and stops matching its neighbours.
 */
export function ghostEventRanges(
  result: MultiEditResult,
  cache: EventDisplaySource | undefined,
): Map<BatchChange, EventChain<JudgeLineEvent> | null> {
  const ranges = new Map<BatchChange, EventChain<JudgeLineEvent> | null>();
  if (!cache) {
    return ranges;
  }
  const groups = new Map<string, BatchChange[]>();
  for (const change of result.changes) {
    if (change.kind !== "events") {
      continue;
    }
    const key = `${change.lineIndex}:${change.type}`;
    const group = groups.get(key);
    if (group) {
      group.push(change);
    } else {
      groups.set(key, [change]);
    }
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const events = eventList(
      {
        chart: result.chart,
        lineIndex: first.lineIndex,
        eventLayer: result.eventLayer,
      },
      first.type,
    );
    const display = cache.eventDisplay(result.chart, events);
    const byEvent = new Map<JudgeLineEvent, EventChain<JudgeLineEvent>>();
    display.ranges.forEach((range, index) => {
      const event = events[index];
      if (event) {
        byEvent.set(event, range);
      }
    });
    for (const change of group) {
      ranges.set(change, byEvent.get(change.after as JudgeLineEvent) ?? null);
    }
  }
  return ranges;
}

/** Collects ids of objects the batch actually changes, copies, or moves. */
export function affectedObjectIds(
  session: EditorSession,
  result: MultiEditResult,
): ChartObjectId[] {
  normalizeChartObjectIds(result.chart);
  const ids = new Set<ChartObjectId>();
  for (const change of result.changes) {
    const id = change.after.id;
    if (!isChartObjectId(id)) {
      continue;
    }
    const moved = sourceLineIndex(session, change.before) !== change.lineIndex;
    if (change.copy || moved || !sameBatchItem(change.before, change.after)) {
      ids.add(id);
    }
  }
  return [...ids];
}
