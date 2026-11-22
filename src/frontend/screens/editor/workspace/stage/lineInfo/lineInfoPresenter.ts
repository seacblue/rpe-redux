/**
 * Builds the line-info text from the chart, tempo, scene, and selected event.
 * It formats values only; the controller owns visibility and update timing.
 */
import type { Chart, JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import type { EventTrack } from "../../../../../../core/global/chart/timing/events.ts";
import { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import {
  shaderEvents,
  shaderIdentity,
} from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import { t } from "../../../../../../i18n/index.ts";

/** Formats a number with `digits` decimals, falling back to zero for non-finite values. */
const format = (value: unknown, digits = 2): string =>
  Number.isFinite(value) ? Number(value).toFixed(digits) : "0.00";

/** Per-second rate of one selected event track, or null when it is not a move track. */
function selectedEventSpeed(
  type: string,
  event: JudgeLineEvent | undefined,
  tempo: TempoMap,
  lineFactor: number,
): string | null {
  if (!event) {
    return null;
  }
  const duration = tempo.seconds(event.endTime) - tempo.seconds(event.startTime);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration) < 0.000001 ||
    !Number.isFinite(event.start) ||
    !Number.isFinite(event.end)
  ) {
    return null;
  }
  const rate = (Number(event.end) - Number(event.start)) / duration;
  if (type === "moveXEvents") {
    return `X ${format(rate / 120)}`;
  }
  if (type === "moveYEvents") {
    return `Y ${format(rate / 120)}`;
  }
  if (type === "rotateEvents") {
    return `R ${format(rate)}`;
  }
  if (type === "speedEvents") {
    return t("editorPanels.lineInfo.speedEvent", { value: format(rate / 120) });
  }
  return null;
}

/** Builds the line-info text for the selected line at `seconds`. */
export function buildLineInfoText(
  scene: SceneRuntime,
  chart: Chart,
  lineIndex: number,
  seconds: number,
  tempo: TempoMap,
  selectedEvents: ReadonlySet<string>,
  getEventList: (type: string) => JudgeLineEvent[],
): string {
  scene.compile(chart, tempo);
  const lineFactor = chart.judgeLineList?.[lineIndex]?.bpmfactor ?? 1;
  const state = scene.sampler(seconds)(lineIndex) ?? {
    x: 0,
    y: 0,
    rotation: 0,
    alpha: 255,
  };
  const runtime = scene.lines[lineIndex];
  const scrollSpeed =
    runtime?.speeds?.reduce((sum, track) => sum + (track.value(seconds) || 0), 0) ?? 0;
  const lineText = [
    t("editorPanels.lineInfo.position", { x: format(state.x), y: format(state.y) }),
    t("editorPanels.lineInfo.direction", { value: format(state.rotation) }),
    t("editorPanels.lineInfo.alpha", { value: format(state.alpha, 0) }),
    t("editorPanels.lineInfo.speed", { value: format(scrollSpeed) }),
  ].join("  ");
  const dt = 1 / 120;
  const before = scene.sampler(seconds - dt)(lineIndex) ?? state;
  const after = scene.sampler(seconds + dt)(lineIndex) ?? state;
  const xSpeed = (after.x - before.x) / (2 * dt) / 120;
  const ySpeed = (after.y - before.y) / (2 * dt) / 120;
  const rotateSpeed = (after.rotation - before.rotation) / (2 * dt);
  const tracks: Record<string, EventTrack<JudgeLineEvent>[] | undefined> = { ...runtime?.tracks };
  const activeSpeeds: string[] = [];
  for (const type of ["moveXEvents", "moveYEvents", "rotateEvents", "speedEvents"]) {
    for (const track of tracks[type] ?? []) {
      for (const entry of track.entries(seconds)) {
        if (seconds < entry.start || seconds > entry.end) {
          continue;
        }
        const rate = selectedEventSpeed(type, entry.event, tempo, lineFactor);
        if (rate) {
          activeSpeeds.push(rate);
        } else if (type === "speedEvents") {
          activeSpeeds.push(
            t("editorPanels.lineInfo.speedEvent", { value: format(track.value(seconds)) }),
          );
        }
      }
    }
  }
  const selectedSpeeds: string[] = [];
  for (const key of selectedEvents) {
    const separator = key.lastIndexOf(":");
    const type = separator < 0 ? key : key.slice(0, separator);
    const index = Number(key.slice(separator + 1));
    const rate = selectedEventSpeed(type, getEventList(type)[index], tempo, lineFactor);
    if (rate) {
      selectedSpeeds.push(rate);
    }
  }
  const eventSpeed = selectedSpeeds.length ? selectedSpeeds : activeSpeeds;
  const eventText = `${t("editorPanels.lineInfo.velocity", {
    values: `${format(xSpeed)}, ${format(ySpeed)}, ${format(rotateSpeed)}`,
  })}${
    eventSpeed.length
      ? `\n${t("editorPanels.lineInfo.eventSpeed", { values: eventSpeed.slice(0, 6).join(", ") })}`
      : ""
  }`;
  const globalShaders: string[] = [];
  for (const index of chart.judgeLineList?.keys?.() ?? []) {
    const eventBeat = tempo.beat(seconds);
    for (const event of shaderEvents(chart, index)) {
      if (!event.global) {
        continue;
      }
      const start = beatValue(event.startTime);
      const end = beatValue(event.endTime ?? event.startTime);
      if (eventBeat >= start && eventBeat < end) {
        globalShaders.push(shaderIdentity(event));
      }
    }
  }
  const shaderText = globalShaders.length
    ? `\n${t("editorPanels.lineInfo.shader", { values: globalShaders.join(", ") })}`
    : "";
  return `${lineText}\n${eventText}${shaderText}`;
}
