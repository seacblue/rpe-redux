/**
 * A line's event tracks as plain lists.
 *
 * Tracks live in two different places — the layer's named fields and the line's
 * `extended` map — and the shader track is not stored as a list at all. This
 * module is the one that knows which is which, so every caller reads a track the
 * same way and writes it back through `chartWithEventLists`, which returns the
 * new chart rather than mutating anything.
 */

import { t } from "../../../i18n/index.ts";
import { values } from "../../state/values.ts";
import { EVENT_TRACKS, EVENT_TYPES } from "../../global/chart/chartVocabulary.ts";
import type {
  Chart,
  JudgeLine,
  JudgeLineEvent,
  MutableEventLayer,
} from "../../global/chart/chart.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import { replaceShaderEvents, shaderEvents } from "../../global/chart/shader/shaderEvents.ts";
import { noiseLineSettings } from "../../global/chart/noise/noiseLine.ts";
import type { BlockAreaInterval } from "../../global/chart/noise/blockArea.ts";

/** The virtual event track stored in editor-only noise settings. */
export const NOISE_ACTIVE_EVENTS = "noiseActiveEvents";

/** Every event track that can appear in a timeline query, including synthetic tracks. */
export const QUERYABLE_EVENT_TRACKS = [...EVENT_TRACKS, NOISE_ACTIVE_EVENTS] as const;

const BASE_EVENT_TRACKS: readonly string[] = EVENT_TYPES;
const EMPTY_NOISE_EVENTS: JudgeLineEvent[] = [];
const activeViews = new WeakMap<readonly BlockAreaInterval[], JudgeLineEvent[]>();

/** A projected activation interval; events carry a fixed value of 1. */
export interface NoiseActiveEvent extends JudgeLineEvent {
  readyFlash?: number | boolean;
}

/**
 * Project active intervals to timeline events.
 *
 * Events stay the timeline's unit of interaction, but the stored schema is the
 * interval list. The cache is keyed by that list so an unchanged chart keeps one
 * stable array and the timeline's event indexes do not rebuild every frame.
 */
export function noiseActiveEvents(line: JudgeLine | undefined): JudgeLineEvent[] {
  const intervals = noiseLineSettings(line)?.area.activeIntervals;
  if (!intervals?.length) {
    return EMPTY_NOISE_EVENTS;
  }
  const cached = activeViews.get(intervals);
  if (cached) {
    return cached;
  }
  const events: NoiseActiveEvent[] = intervals.map((interval) => ({
    startTime: [...interval.startTime],
    endTime: [...interval.endTime],
    start: 1,
    end: 1,
    easingType: 1,
    ...(interval.readyFlash === undefined ? {} : { readyFlash: interval.readyFlash }),
  }));
  activeViews.set(intervals, events);
  return events;
}

/** A judge line whose `extended` map accepts a computed track name. */
interface MutableLine extends JudgeLine {
  extended?: MutableEventLayer;
}

/**
 * The slice of a session the event tracks read. Kept structural because
 * `selectionHistory.ts` also queries tracks on detached selection snapshots.
 */
export interface EventSession {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
}

/** Builds the selection key for one event in a named track. */
export const eventKey = (type: string, index: number): string => `${type}:${index}`;

/** Whether the settings-page XY binding applies to ordinary event edits. */
export function globalXYBindingEnabled(): boolean {
  return values.byId.has("xy-binding") && values.byId.get<boolean>("xy-binding") === true;
}

/** Return the other position-axis track when the event type participates in XY binding. */
export function xyCounterpartType(type: string): "moveXEvents" | "moveYEvents" | null {
  if (type === "moveXEvents") {
    return "moveYEvents";
  }
  if (type === "moveYEvents") {
    return "moveXEvents";
  }
  return null;
}

/** Compare event spans by beat values, accepting equivalent beat encodings. */
export function sameEventSpan(left: JudgeLineEvent, right: JudgeLineEvent): boolean {
  return (
    Math.abs(beatValue(left.startTime) - beatValue(right.startTime)) < 1e-9 &&
    Math.abs(beatValue(left.endTime) - beatValue(right.endTime)) < 1e-9
  );
}

/** Decode an event-selection key; the track is the prefix before the last colon. */
export function parseEventKey(key: string): { type: string; index: number } | null {
  const colon = key.lastIndexOf(":");
  if (colon <= 0) {
    return null;
  }
  const index = Number(key.slice(colon + 1));
  return Number.isInteger(index) && index >= 0 ? { type: key.slice(0, colon), index } : null;
}
/** Read one event list, choosing the normal layer or the extended map by track kind. */
export function eventListAt(
  session: EventSession,
  lineIndex: number,
  type: string,
  layer = session.eventLayer,
): JudgeLineEvent[] {
  if (type === "paintEvents") {
    return shaderEvents(session.chart, lineIndex);
  }
  const line = session.chart.judgeLineList?.[lineIndex];
  if (type === NOISE_ACTIVE_EVENTS) {
    return noiseActiveEvents(line);
  }
  if (BASE_EVENT_TRACKS.includes(type)) {
    const layers = line?.eventLayers?.[layer] as MutableEventLayer | null | undefined;
    return layers?.[type] ?? [];
  }
  const extended = line?.extended as MutableEventLayer | undefined;
  return extended?.[type] ?? [];
}
/** Read one event list on the session's current line. */
export function eventList(session: EventSession, type: string): JudgeLineEvent[] {
  return eventListAt(session, session.lineIndex, type);
}

/** Return a chart with the given track replacements without rejecting drawable-time issues. */
export function chartWithEventLists(
  source: Chart,
  lineIndex: number,
  eventLayer: number,
  updates: Map<string, JudgeLineEvent[]>,
): Chart {
  const target = source.judgeLineList?.[lineIndex];
  if (!target) {
    throw new Error(t("editor.commands.eventCommands.error.needLine"));
  }
  const eventLayers = [...(target.eventLayers ?? [])];
  const line: MutableLine = {
    ...target,
    extended: { ...target.extended },
    eventLayers,
  };
  for (const [type, events] of updates) {
    if (type === "paintEvents") {
      continue;
    }
    if (type === NOISE_ACTIVE_EVENTS) {
      const settings = noiseLineSettings(line);
      if (!settings) {
        throw new Error(t("editorPanels.linePanel.noiseActiveInvalid"));
      }
      const activeIntervals: BlockAreaInterval[] = events.map((event) => {
        if (event.start !== 1 || event.end !== 1) {
          throw new Error(t("editorPanels.linePanel.noiseActiveInvalid"));
        }
        const readyFlash = (event as NoiseActiveEvent).readyFlash ?? 0.5;
        return {
          startTime: [...event.startTime],
          endTime: [...event.endTime],
          readyFlash,
        };
      });
      line._reduxNoiseLine = {
        ...settings,
        area: { ...settings.area, activeIntervals },
      };
      continue;
    }
    if (BASE_EVENT_TRACKS.includes(type)) {
      while (eventLayers.length <= eventLayer) {
        eventLayers.push({});
      }
      const layer: MutableEventLayer = { ...eventLayers[eventLayer] };
      layer[type] = events;
      eventLayers[eventLayer] = layer;
    } else {
      const extended = line.extended;
      if (extended) {
        extended[type] = events;
      }
    }
  }
  const lines = [...(source.judgeLineList ?? [])];
  lines[lineIndex] = line;
  let chart: Chart = { ...source, judgeLineList: lines };
  if (updates.has("paintEvents")) {
    chart = replaceShaderEvents(chart, lineIndex, updates.get("paintEvents") ?? []);
  }
  return chart;
}
