/**
 * Writes an RPE chart as PhiEdit PEC text.
 *
 * PEC has one global BPM list, paired line movement and a 30-line limit. The
 * writer samples the runtime on a beat grid, bakes parenting, event layers and
 * easing into linear commands, and warns when a feature cannot be represented.
 */
import { lineParentIndex, type Chart } from "../chart.ts";
import { CONTROL_TRACKS } from "../chartTracks.ts";
import { judgeLineTraits } from "../line/lineTraits.ts";
import { SceneRuntime } from "../runtime/scene.ts";
import { beatValue } from "../timing/beat.ts";
import { TempoMap } from "../timing/tempo.ts";
import {
  PEC_MAX_LINES,
  PEC_LINE_HALF_WIDTH,
  RPE_LINE_HALF_WIDTH,
  RPE_NOTE_TO_PEC,
  RPE_SPEED_PER_PEC_SPEED,
  type SerializedExternalChart,
  finiteNumber,
  roundNumber,
  textNumber,
} from "./common.ts";
import { LinearTrack, MoveTrack, SpeedTrack } from "./sampling.ts";
import { PEC_OFFSET_BIAS, WarningLog, toPecLineX, toPecLineY } from "./pecParse.ts";

export { parsePecChart } from "./pecParse.ts";

/** Beats per grid step used when baking an RPE chart into PEC. */
const PEC_SAMPLE_STEP = 1 / 32;

/** Upper bound on grid samples before the step is coarsened. */
const PEC_MAX_GRID_SAMPLES = 120_000;

/** A sampled line's PEC-format builders. */
interface PecBuilder {
  index: number;
  move: MoveTrack;
  rotate: LinearTrack;
  alpha: LinearTrack;
  speed: SpeedTrack;
  lastTime: number;
  lastSeconds: number;
  lastFloor: number;
  first: boolean;
}

/** Add one sampled frame to a PEC builder. */
function pushPecFrame(
  builder: PecBuilder,
  time: number,
  seconds: number,
  state: { x: number; y: number; rotation: number; alpha: number; floor: number },
): void {
  builder.move.push(time, toPecLineX(state.x), toPecLineY(state.y));
  builder.rotate.push(time, state.rotation);
  builder.alpha.push(time, Math.min(255, Math.max(0, state.alpha)));
  if (builder.first) {
    builder.first = false;
    builder.lastTime = time;
    builder.lastSeconds = seconds;
    builder.lastFloor = state.floor;
    return;
  }
  const duration = seconds - builder.lastSeconds;
  if (duration > 1e-9) {
    const rpeSpeed = (state.floor - builder.lastFloor) / duration / 120;
    builder.speed.push(builder.lastTime, time, rpeSpeed / RPE_SPEED_PER_PEC_SPEED, 0);
  }
  builder.lastTime = time;
  builder.lastSeconds = seconds;
  builder.lastFloor = state.floor;
}

/** Maximum chart time in seconds across every event layer and note. */
function chartSeconds(chart: Chart, tempo: TempoMap): number {
  let maximum = 0;
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const events of Object.values(layer ?? {})) {
        for (const event of events ?? []) {
          maximum = Math.max(maximum, tempo.seconds(event.endTime));
        }
      }
    }
    for (const note of line.notes ?? []) {
      maximum = Math.max(maximum, tempo.seconds(note.endTime));
    }
  }
  return maximum;
}

/** Sample beats for PEC export, including exact event and note boundaries. */
function sampleBeats(chart: Chart, tempo: TempoMap, maxBeat: number): number[] {
  const beats = new Set<number>();
  const step = Math.max(PEC_SAMPLE_STEP, maxBeat / PEC_MAX_GRID_SAMPLES);
  for (let beat = 0; beat <= maxBeat; beat += step) {
    beats.add(roundNumber(beat, 6));
  }
  beats.add(roundNumber(maxBeat, 6));
  const add = (seconds: number): void => {
    if (Number.isFinite(seconds)) {
      beats.add(roundNumber(tempo.beat(seconds), 6));
    }
  };
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const events of Object.values(layer ?? {})) {
        for (const event of events ?? []) {
          add(tempo.seconds(event.startTime));
          add(tempo.seconds(event.endTime));
        }
      }
    }
    for (const note of line.notes ?? []) {
      add(tempo.seconds(note.startTime));
      add(tempo.seconds(note.endTime));
    }
  }
  return [...beats].sort((left, right) => left - right);
}

/** Export one RPE chart as PEC text. */
export function serializePecChart(chart: Chart): SerializedExternalChart {
  const tempo = new TempoMap(chart.BPMList);
  const lines = chart.judgeLineList ?? [];
  const warnings = new WarningLog();
  if (chart.blockAreaList?.length) {
    warnings.add("Noise areas (blockAreaList) are not exported to PEC.");
  }
  if (lines.some((line) => lineParentIndex(line.father) >= 0)) {
    warnings.add("Parented lines were flattened into world-space events.");
  }
  if (
    lines.some((line) =>
      CONTROL_TRACKS.some(
        (track) => ((line as unknown as Record<string, unknown[]>)[track.field]?.length ?? 0) > 1,
      ),
    )
  ) {
    warnings.add("Judge-line note control curves are not exported to PEC.");
  }
  if (lines.some((line) => Number(line.isCover ?? 1) !== 1)) {
    warnings.add("Judge-line masks are not exported to PEC.");
  }
  if (
    lines.some((line) =>
      [
        "scaleXEvents",
        "scaleYEvents",
        "colorEvents",
        "textEvents",
        "inclineEvents",
        "paintEvents",
        "gifEvents",
      ].some(
        (key) => ((line.extended as Record<string, unknown[]> | undefined)?.[key]?.length ?? 0) > 0,
      ),
    )
  ) {
    warnings.add("Extended line events are not exported to PEC.");
  }
  const indices = lines
    .map((line, index) => ({ line, index, traits: judgeLineTraits(line) }))
    .filter(({ line, traits }) => {
      if (traits.purpose !== "standard") {
        warnings.add(`A ${traits.purpose} line was not exported to PEC.`);
        return false;
      }
      if (line.attachUI) {
        warnings.add("UI-bound lines were not exported to PEC.");
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        Number(left.line.zOrder ?? 0) - Number(right.line.zOrder ?? 0) || left.index - right.index,
    )
    .map(({ index }) => index);
  if (indices.length > PEC_MAX_LINES) {
    throw new Error(
      `PEC supports at most ${PEC_MAX_LINES} judge lines; this chart needs ${indices.length}.`,
    );
  }

  const maxSeconds = chartSeconds(chart, tempo);
  const maxBeat = Math.max(1, tempo.beat(maxSeconds) + 1);
  const beats = sampleBeats(chart, tempo, maxBeat);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const builders: PecBuilder[] = indices.map((index) => ({
    index,
    move: new MoveTrack(),
    rotate: new LinearTrack(),
    alpha: new LinearTrack(),
    speed: new SpeedTrack(),
    lastTime: Number.NaN,
    lastSeconds: Number.NaN,
    lastFloor: 0,
    first: true,
  }));
  for (const beat of beats) {
    const seconds = tempo.seconds(beat);
    const states = scene.sample(seconds);
    for (const builder of builders) {
      const state = states[builder.index];
      if (state) {
        pushPecFrame(builder, beat, seconds, state);
      }
    }
  }

  const output: string[] = [];
  output.push(String(Math.round(finiteNumber(chart.META.offset, 0) + PEC_OFFSET_BIAS)));
  for (const entry of [...chart.BPMList].sort(
    (left, right) => beatValue(left.startTime) - beatValue(right.startTime),
  )) {
    output.push(`bp ${textNumber(beatValue(entry.startTime))} ${textNumber(entry.bpm)}`);
  }
  output.push("");

  for (const [outputIndex] of indices.entries()) {
    const builder = builders[outputIndex];
    for (const move of builder.move.result()) {
      output.push(
        `cp ${outputIndex} ${textNumber(move.startTime)} ${textNumber(move.start)} ${textNumber(move.start2)}`,
      );
      output.push(
        `cm ${outputIndex} ${textNumber(move.startTime)} ${textNumber(move.endTime)} ${textNumber(move.end)} ${textNumber(move.end2)} 1`,
      );
    }
    for (const rotate of builder.rotate.result()) {
      output.push(`cd ${outputIndex} ${textNumber(rotate.startTime)} ${textNumber(rotate.start)}`);
      output.push(
        `cr ${outputIndex} ${textNumber(rotate.startTime)} ${textNumber(rotate.endTime)} ${textNumber(rotate.end)} 1`,
      );
    }
    for (const alpha of builder.alpha.result()) {
      output.push(`ca ${outputIndex} ${textNumber(alpha.startTime)} ${textNumber(alpha.start)}`);
      output.push(
        `cf ${outputIndex} ${textNumber(alpha.startTime)} ${textNumber(alpha.endTime)} ${textNumber(alpha.end)} 1`,
      );
    }
    for (const speed of builder.speed.result()) {
      output.push(`cv ${outputIndex} ${textNumber(speed.startTime)} ${textNumber(speed.value)}`);
    }
    output.push("");
  }

  for (const [outputIndex, index] of indices.entries()) {
    const line = lines[index]!;
    for (const note of line.notes ?? []) {
      const command = RPE_NOTE_TO_PEC[note.type];
      if (!command) {
        warnings.add("A note with an unknown type was skipped.");
        continue;
      }
      if (Number(note.alpha ?? 255) !== 255) {
        warnings.add("Note opacity is not exported to PEC.");
      }
      if (Number(note.yOffset ?? 0) !== 0) {
        warnings.add("Note Y offset is not exported to PEC.");
      }
      if (Number(note.visibleTime ?? 999999) !== 999999) {
        warnings.add("Note visible time is not exported to PEC.");
      }
      const startBeat = tempo.beat(tempo.seconds(note.startTime));
      const endBeat = tempo.beat(tempo.seconds(note.endTime));
      const x = (Number(note.positionX ?? 0) * PEC_LINE_HALF_WIDTH) / RPE_LINE_HALF_WIDTH;
      const above = Number(note.above ?? 1) === 1 ? 1 : 2;
      const fake = Number(note.isFake ?? 0) === 1 ? 1 : 0;
      if (note.type === 2) {
        output.push(
          `${command} ${outputIndex} ${textNumber(startBeat)} ${textNumber(endBeat)} ${textNumber(x)} ${above} ${fake}`,
        );
      } else {
        output.push(
          `${command} ${outputIndex} ${textNumber(startBeat)} ${textNumber(x)} ${above} ${fake}`,
        );
      }
      output.push(`# ${textNumber(Math.max(0, finiteNumber(note.speed, 1)))}`);
      output.push(`& ${textNumber(Math.max(0, finiteNumber(note.size, 1)))}`);
    }
  }
  return { text: `${output.join("\n")}\n`, warnings: warnings.values };
}

/** True when a text looks like a PEC chart. */
export function looksLikePecChart(text: string): boolean {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#"));
  if (!lines.length || !Number.isFinite(Number(lines[0]))) {
    return false;
  }
  return lines.some((line) => /^(?:bp|c[pmdraf]\w*|cv|cvelocity|n[1-4])\b/i.test(line));
}
