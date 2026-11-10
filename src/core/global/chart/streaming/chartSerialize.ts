/**
 * Chunked chart serialization for streaming saves. Values are emitted one at a
 * time so the renderer never builds a whole-chart JSON string; negative zero is
 * preserved with the same rule as `serializeChart`.
 */
import type { Chart } from "../chart.ts";

/** True when the value graph contains a negative zero that JSON would drop. */
function containsNegativeZero(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "number") {
    return Object.is(value, -0);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      if (containsNegativeZero(child, seen)) {
        return true;
      }
    }
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (Object.hasOwn(record, key) && containsNegativeZero(record[key], seen)) {
      return true;
    }
  }
  return false;
}

/** Serialize JSON while keeping negative zero as `-0`. */
export function stringifyChartValue(value: unknown): string {
  if (!containsNegativeZero(value)) {
    return JSON.stringify(value);
  }
  const ordinary = JSON.stringify(value);
  let marker = "\u0000rpe-negative-zero\u0000";
  while (ordinary.includes(JSON.stringify(marker))) {
    marker += "#";
  }
  return JSON.stringify(value, (key, entry) => (Object.is(entry, -0) ? marker : entry)).replaceAll(
    JSON.stringify(marker),
    "-0",
  );
}

/** Write a plain chart as JSON chunks without materializing one string. */
export async function serializeChartChunks(
  chart: Chart,
  sink: (chunk: string) => Promise<void> | void,
): Promise<void> {
  const { judgeLineList: lines, ...header } = chart as Chart & Record<string, unknown>;
  const keys = Object.keys(header);
  await sink("{");
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    await sink(`${index ? "," : ""}${JSON.stringify(key)}:${stringifyChartValue(header[key])}`);
  }
  await sink(`${keys.length ? "," : ""}"judgeLineList":[`);
  const list = Array.isArray(lines) ? lines : [];
  for (let index = 0; index < list.length; index++) {
    if (index) {
      await sink(",");
    }
    await sink(stringifyChartValue(list[index]));
  }
  await sink("]}");
}
