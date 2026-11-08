/**
 * Chart-side shader event helpers.
 *
 * Normalises shader events into the ordinary event contract, assigns lanes,
 * parses `uniform` declarations and parameter tracks, and remaps shader line
 * references when lines move. Identity helpers are re-exported from `shader.ts`.
 */
import { t } from "../../../../i18n/index.ts";
import { isRecord } from "../../../utils/guards.ts";
import {
  beatValue,
  fromNumber,
  isOrderedBeatRange,
  normalizeBeat,
  type Beat,
} from "../timing/beat.ts";
import type { Chart, JudgeLineEvent } from "../chart.ts";
import { SHADER_NAMES, shaderIdentity, shaderLine } from "./shader.ts";
import type { ShaderVarTrack } from "./sampling.ts";
export { shaderIdentity, shaderLine } from "./shader.ts";

/** The lane occupied by an event and the number of lanes in its group. */
export interface ShaderLane {
  lane: number;
  count: number;
}

/**
 * The output shape of `shaderEvents`: unknown JSON is normalized to the same
 * event contract used by ordinary timeline tracks. Shader-specific fields stay
 * on the object through the chart event's open extension shape.
 */
export type ShaderChartEvent = JudgeLineEvent;

/** The result of `shaderTypeFields`: shader source path and clone requirement. */
export interface ShaderTypeFields {
  shader: string;
  clone: boolean;
}

/** One `uniform` declaration: name, GLSL type, component count and default. */
export interface ShaderParameter {
  name: string;
  type: string;
  dimensions: number;
  value: number | number[];
  /** Optional user-facing name configured in the asset library. */
  label?: string;
}

/** One asset-library override for a shader uniform. */
export interface ShaderParameterOverride {
  enabled: boolean;
  label?: string;
}

/** Persisted shader uniform settings keyed by uniform name. */
export type ShaderParameterOverrides = Record<string, ShaderParameterOverride>;

const SHADER_PARAMETER_CONFIG_KEY = "ReduxShaderParameters";

/** Per-chart cache of normalized shader events, keyed by line index. */
const cache = new WeakMap<Chart, Map<number, ShaderChartEvent[]>>();

/** Assign overlapping events to lanes and report each group's lane count. */
export function shaderEventLanes(
  events: readonly { startTime: readonly number[]; endTime: readonly number[] }[],
): Map<number, ShaderLane> {
  const layout = new Map<number, ShaderLane>();
  let group: { index: number; lane: number }[] = [];
  let lanes: number[] = [];
  let groupEnd = -Infinity;
  // Close the current lane group and publish its width.
  const finish = (): void => {
    for (const entry of group) {
      layout.set(entry.index, { lane: entry.lane, count: lanes.length });
    }
  };
  const ordered = events
    .map((event, index) => ({
      event,
      index,
    }))
    .filter((entry) => isOrderedBeatRange(entry.event.startTime, entry.event.endTime))
    .map((entry) => ({
      index: entry.index,
      start: beatValue(entry.event.startTime),
      end: beatValue(entry.event.endTime),
    }))
    .sort((left, right) => left.start - right.start || left.index - right.index);
  for (const entry of ordered) {
    if (entry.start >= groupEnd) {
      finish();
      group = [];
      lanes = [];
      groupEnd = -Infinity;
    }
    let lane = lanes.findIndex((end) => end <= entry.start);
    if (lane < 0) {
      lane = lanes.length;
    }
    lanes[lane] = entry.end;
    group.push({ index: entry.index, lane });
    groupEnd = Math.max(groupEnd, entry.end);
  }
  finish();
  return layout;
}

/** Resolve a shader name to its source file and whether a `_2` clone variant is used. */
export function shaderTypeFields(name: string): ShaderTypeFields {
  const index = SHADER_NAMES.indexOf(name);
  const base = index >= 10 && index < 20 ? SHADER_NAMES[index - 10] : name;
  const shader =
    index >= 20
      ? `/${base}_pr.glsl`
      : base.replace(/_(\w)/g, (match, letter: string) => letter.toUpperCase());
  return { shader, clone: index >= 10 && index < 20 };
}

/** Read an event time as a normalized beat, accepting a tuple or a number. */
function eventBeat(value: unknown): Beat {
  if (Array.isArray(value)) {
    beatValue(value, "shader event time");
    return normalizeBeat(value);
  }
  return fromNumber(Number(value) || 0);
}

/**
 * Return the shader events attached to one line.
 *
 * Sources are `effects`, `shaderEvents`, `META.effects` and the line's paint
 * track; results are cached per chart and line.
 */
export function shaderEvents(chart: Chart, lineIndex: number): ShaderChartEvent[] {
  let lines = cache.get(chart);
  if (!lines) {
    lines = new Map();
    cache.set(chart, lines);
  }
  if (!lines.has(lineIndex)) {
    const roots: Record<string, unknown>[] = [
      chart.effects,
      chart.shaderEvents,
      chart.META?.effects,
    ]
      .filter(Array.isArray)
      .flat()
      .filter((event): event is Record<string, unknown> => isRecord(event) || Array.isArray(event));
    const effects = [
      ...roots.filter((event) => shaderLine(event, chart) === lineIndex),
      ...(chart.judgeLineList?.[lineIndex]?.extended?.paintEvents ?? []),
    ];
    lines.set(
      lineIndex,
      effects.map((event): ShaderChartEvent => {
        const startTime = eventBeat(event.startTime ?? event.start);
        const endTime = eventBeat(event.endTime ?? event.end);
        return {
          ...event,
          startTime,
          endTime,
          start: startTime,
          end: endTime,
        };
      }),
    );
  }
  return lines.get(lineIndex) ?? [];
}

/** Project one event into the on-disk shader effect shape for `lineIndex`. */
export function serializeShaderEvent(event: ShaderChartEvent, lineIndex: number) {
  const { startTime, endTime, ...effect } = event;
  return {
    ...effect,
    ...(event.shader ? {} : shaderTypeFields(shaderIdentity(event))),
    line: lineIndex,
    start: startTime,
    end: endTime,
  };
}

/**
 * Replace one line's shader events without touching other lines.
 *
 * Events for other lines are kept; every shader root is rewritten with the new
 * list. Non-array roots are treated as empty.
 */
export function replaceShaderEvents(
  chart: Chart,
  lineIndex: number,
  events: readonly ShaderChartEvent[],
): Chart {
  // Keep non-object entries and every event owned by another line.
  const keep = (list: unknown): unknown[] =>
    (Array.isArray(list) ? list : []).filter(
      (event) =>
        (!isRecord(event) && !Array.isArray(event)) ||
        shaderLine(event as Record<string, unknown>, chart) !== lineIndex,
    );
  const lines = [...(chart.judgeLineList ?? [])];
  const current = lines[lineIndex];
  const currentExtended = current.extended;
  if (currentExtended?.paintEvents) {
    const { paintEvents, ...extended } = currentExtended;
    lines[lineIndex] = { ...current, extended };
  }
  return {
    ...chart,
    judgeLineList: lines,
    effects: [
      ...keep(chart.effects),
      ...events.map((event) => serializeShaderEvent(event, lineIndex)),
    ],
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: keep(chart.shaderEvents) } : {}),
    ...(Array.isArray(chart.META?.effects)
      ? { META: { ...chart.META, effects: keep(chart.META.effects) } }
      : {}),
  };
}

/**
 * Rewrite shader line references after a structural edit.
 *
 * `destinations` maps source line indices to their new positions; `duplicate` also
 * copies the line's effects onto the appended line.
 */
export function remapShaderLines(
  chart: Chart,
  next: Chart,
  destinations: ReadonlyMap<unknown, number>,
  duplicate = -1,
): Chart {
  const remap = (effects: unknown[]): unknown[] =>
    effects.flatMap((event) => {
      if (!isRecord(event) && !Array.isArray(event)) {
        return [event];
      }
      const owner = shaderLine(event as Record<string, unknown>, chart);
      const destination = destinations.get(owner);
      if (destination === undefined) {
        return [];
      }
      const result: unknown[] = [{ ...event, line: destination }];
      if (owner === duplicate) {
        result.push({ ...structuredClone(event), line: (next.judgeLineList ?? []).length - 1 });
      }
      return result;
    });
  return {
    ...next,
    ...(Array.isArray(chart.effects) ? { effects: remap(chart.effects) } : {}),
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: remap(chart.shaderEvents) } : {}),
    ...(Array.isArray(chart.META?.effects)
      ? { META: { ...next.META, effects: remap(chart.META.effects) } }
      : {}),
  };
}

/** Read one parameter track from an event, falling back to a constant segment. */
export function shaderParameterTrack(
  event: JudgeLineEvent,
  name: string,
  fallback: unknown = 0,
): ShaderVarTrack {
  const vars = event.vars;
  const value = (isRecord(vars) ? vars[name] : undefined) ?? fallback;
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    return value;
  }
  return [
    {
      startTime: event.startTime,
      endTime: event.endTime,
      start: structuredClone(value),
      end: structuredClone(value),
      easingType: 1,
    },
  ];
}

/** Shift a parameter track so its first segment starts at `beat`. */
export function alignShaderTrack(track: ShaderVarTrack, beat: readonly number[]): ShaderVarTrack {
  if (!track.length) {
    return track;
  }
  const delta = beatValue(beat) - Math.min(...track.map((segment) => beatValue(segment.startTime)));
  return track.map((segment) => ({
    ...segment,
    startTime: fromNumber(beatValue(segment.startTime) + delta),
    endTime: fromNumber(beatValue(segment.endTime) + delta),
  }));
}

/** Align every parameter track on an event to the event's own start beat. */
export function alignShaderParameters(event: JudgeLineEvent): JudgeLineEvent {
  return {
    ...event,
    vars: Object.fromEntries(
      Object.entries(isRecord(event.vars) ? event.vars : {}).map(([name, value]) => [
        name,
        Array.isArray(value) && value[0] && typeof value[0] === "object"
          ? alignShaderTrack(value, event.startTime)
          : value,
      ]),
    ),
  };
}

/** Read editable numeric/vector uniforms and their `%...%` defaults from shader source text. */
export function shaderParameters(source: string): ShaderParameter[] {
  const text = source
    .replace(/\/*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/\/\/([^\r\n]*)/g, (_, comment: string) =>
      /%[^%]+%/.test(comment) ? ` // ${comment.replace(/uniform/g, "")}` : "",
    );
  return [
    ...text.matchAll(
      /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec[234])\s+(\w+)\s*;([^\r\n]*)/g,
    ),
  ].map(([, type, name, comment]) => {
    const dimensions = type.startsWith("vec") ? Number(type.at(-1)) : 1;
    const rawValues = comment.match(/%([^%]+)%/)?.[1];
    const values = rawValues?.split(",").map(Number);
    const fallback =
      values?.length === dimensions && values.every(Number.isFinite)
        ? values
        : new Array<number>(dimensions).fill(0);
    return {
      name,
      type,
      dimensions,
      value: dimensions === 1 ? fallback[0] : fallback,
    };
  });
}

/** Read the optional shader uniform configuration stored in chart metadata. */
export function shaderParameterOverrides(
  chart: Chart | null | undefined,
  shader: string,
): ShaderParameterOverrides | null {
  const root = chart?.META?.[SHADER_PARAMETER_CONFIG_KEY];
  if (!isRecord(root) || !isRecord(root[shader])) {
    return null;
  }
  return root[shader] as ShaderParameterOverrides;
}

/** Apply asset-library uniform settings to the declarations found in a shader source. */
export function shaderParametersForChart(
  chart: Chart | null | undefined,
  shader: string,
  source: string,
): ShaderParameter[] {
  const detected = shaderParameters(source);
  const overrides = shaderParameterOverrides(chart, shader);
  if (!overrides) {
    return detected;
  }
  return detected.flatMap((parameter) => {
    const override = overrides[parameter.name];
    if (!override || override.enabled === false) {
      return [];
    }
    return [
      {
        ...parameter,
        ...(override.label?.trim() ? { label: override.label.trim() } : {}),
      },
    ];
  });
}

/** Store one shader's explicit uniform settings in the chart metadata. */
export function setShaderParameterOverrides(
  chart: Chart,
  shader: string,
  overrides: ShaderParameterOverrides,
): Chart {
  const current = isRecord(chart.META[SHADER_PARAMETER_CONFIG_KEY])
    ? chart.META[SHADER_PARAMETER_CONFIG_KEY]
    : {};
  return {
    ...chart,
    META: {
      ...chart.META,
      [SHADER_PARAMETER_CONFIG_KEY]: {
        ...current,
        [shader]: overrides,
      },
    },
  };
}

/** Parse comma-separated component text for a uniform, throwing `invalidValue` on mismatch. */
export function parseShaderValue(text: unknown, dimensions: number): number | number[] {
  const parts = String(text)
    .split(",")
    .map((part) => part.trim());
  const values = parts.map(Number);
  if (
    parts.some((part) => !part) ||
    values.length !== dimensions ||
    !values.every(Number.isFinite)
  ) {
    throw new Error(t("model.shader.invalidValue", { dimensions }));
  }
  return dimensions === 1 ? values[0] : values;
}
