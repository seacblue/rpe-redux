/**
 * Plans the event clone page against a captured selection.
 *
 * The clone sequence is ordered and keeps repeated target lines: one entry in
 * the target expression is one copy, so the same line can receive several
 * copies with different time offsets and channel values. Planning stays pure;
 * the panel draws the result and commits it as one history entry.
 */
import { t } from "../../../i18n/index.ts";
import { beatValue, fromNumber } from "../../global/chart/timing/beat.ts";
import type { Chart } from "../../global/chart/chart.ts";
import { compileExpression } from "../../utils/batchScript.ts";
import { lineSelectionGroups, parseLineSelectionInput } from "../state/lineSelectionInput.ts";
import { resolveLineSequence } from "../state/lineSelectionTokens.ts";
import type { SelectionSnapshot } from "../selection/snapshot.ts";
import { NOISE_ACTIVE_EVENTS } from "../events/eventTracks.ts";
import { distribution, randomSource, type Distribution } from "./distribution.ts";
import { assemble, validateChange } from "./plan.ts";
import {
  CLONE_CHANNELS,
  defaultCloneChannelParameters,
  type CloneChannelParameters,
  type CloneChannelType,
  type CloneParameters,
} from "./parameters.ts";
import type { BatchChange, MultiEditResult } from "./planVocabulary.ts";

/** The largest number of copies one plan may create. */
export const CLONE_LIMIT = 100_000;

/** One clone preview: its assembled result and the numbers the form reports. */
export interface EventClonePreview {
  result: MultiEditResult;
  /** The expanded target sequence, including repeated lines. */
  targets: readonly number[];
  /** How many selected events supplied the copies. */
  sourceCount: number;
  /** Whether a target line is also one of the source lines. */
  overlapsSource: boolean;
}

/** Build one channel's distribution from the same fields the edit page uses. */
function channelDistribution(channel: CloneChannelParameters, random: () => number): Distribution {
  return distribution(channel, random);
}

/** Resolve the authored target expression into its ordered, duplicate-preserving sequence. */
function cloneTargets(chart: Chart, targets: string): number[] {
  const lineCount = chart.judgeLineList?.length ?? 0;
  const available = Array.from({ length: lineCount }, (unused, index) => index);
  const groups = lineSelectionGroups(chart);
  const parsed = parseLineSelectionInput(targets, available, groups);
  if (!parsed) {
    throw new Error(t("editor.commands.multiEdit.clone.error.targets"));
  }
  return resolveLineSequence(parsed.tokens, available, groups);
}

/**
 * Plan one clone run.
 *
 * Every selected event is copied to every target sequence entry. Target entry
 * `k` shifts times by `k * increment / division` beats and adds that entry's
 * channel distribution to both event values. Removing the source happens after
 * the copies are planned, so a target sequence may include a source line.
 */
export function previewEventClone(
  snapshot: SelectionSnapshot,
  options: CloneParameters,
  division: number,
): EventClonePreview {
  const sourceCount = snapshot.events.length;
  if (!sourceCount) {
    throw new Error(t("editor.commands.multiEdit.clone.error.noSelection"));
  }
  if (snapshot.events.some((entry) => entry.type === NOISE_ACTIVE_EVENTS)) {
    throw new Error(t("editor.commands.multiEdit.clone.error.noise"));
  }
  const targets = cloneTargets(snapshot.chart, options.targets);
  if (!targets.length) {
    throw new Error(t("editor.commands.multiEdit.clone.error.targets"));
  }
  if (targets.length * sourceCount > CLONE_LIMIT) {
    throw new Error(
      t("editor.commands.multiEdit.clone.error.tooMany", {
        count: targets.length * sourceCount,
      }),
    );
  }
  const incrementValue = compileExpression(String(options.increment ?? "0"))({});
  if (!Number.isFinite(incrementValue)) {
    throw new Error(t("editor.commands.multiEdit.clone.error.increment"));
  }
  const parts = Number.isFinite(division) && division > 0 ? division : 4;
  const increment = incrementValue / parts;
  const random = randomSource(options.seed ?? 1);
  const modifiers = new Map<CloneChannelType, Distribution>();
  for (const type of CLONE_CHANNELS) {
    modifiers.set(
      type,
      channelDistribution(options.channels[type] ?? defaultCloneChannelParameters(), random),
    );
  }
  const lineCount = snapshot.chart.judgeLineList?.length ?? 0;
  const sourceLines = new Set(
    snapshot.events.map((entry) =>
      Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex,
    ),
  );
  const changes: BatchChange[] = [];
  for (const entry of snapshot.events) {
    const { type, index, event } = entry;
    targets.forEach((lineIndex, targetIndex) => {
      const offset = targetIndex * increment;
      const after = structuredClone(event);
      if (offset !== 0) {
        after.startTime = fromNumber(beatValue(event.startTime) + offset);
        after.endTime = fromNumber(beatValue(event.endTime) + offset);
      }
      const modifier = modifiers.get(type as CloneChannelType);
      if (modifier) {
        const progress = targets.length > 1 ? targetIndex / (targets.length - 1) : 0;
        const value = modifier(targetIndex, progress);
        if (value !== null) {
          if (typeof after.start === "number") {
            after.start += value;
          }
          if (typeof after.end === "number") {
            after.end += value;
          }
        }
      }
      const change: BatchChange = {
        kind: "events",
        type,
        index,
        before: event,
        after,
        lineIndex,
        copy: true,
      };
      validateChange(change, lineCount, snapshot);
      changes.push(change);
    });
  }
  return {
    result: assemble(snapshot, changes, "events", options.retainSource === false, true),
    targets,
    sourceCount,
    overlapsSource: targets.some((line) => sourceLines.has(line)),
  };
}
