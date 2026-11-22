/**
 * Converts between Phigros official chart JSON and the editor's RPE chart.
 *
 * Official charts use one fixed BPM per judge line, 1/32-beat time units,
 * normalized move coordinates, 0..1 opacity and linear-only events. RPE charts
 * use a global tempo map, beat triples, 1350x900 line coordinates, 0..255
 * opacity and easing. Import keeps every basic playable feature; export samples
 * the runtime into 1/32-beat linear events and reports the RPE features the
 * official format cannot carry.
 */
import {
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
  lineParentIndex,
  noteIsAbove,
} from "../chart.ts";
import { CONTROL_TRACKS } from "../chartTracks.ts";
import { judgeLineTraits } from "../line/lineTraits.ts";
import { SceneRuntime } from "../runtime/scene.ts";
import { beatValue } from "../timing/beat.ts";
import { TempoMap } from "../timing/tempo.ts";
import { isRecord } from "../../../utils/guards.ts";
import {
  OFFICIAL_NOTE_TO_RPE,
  RPE_NOTE_TO_OFFICIAL,
  RPE_LINE_HALF_HEIGHT,
  RPE_LINE_HALF_WIDTH,
  RPE_PIXELS_PER_OFFICIAL_Y,
  RPE_SPEED_PER_OFFICIAL_SPEED,
  RPE_UNITS_PER_OFFICIAL_X,
  type ConvertedExternalChart,
  type ExternalChartMetadata,
  type SerializedExternalChart,
  emptyLayer,
  finiteNumber,
  makeChart,
  makeEvent,
  makeLine,
  makeNote,
  positiveNumber,
  roundNumber,
  updateNoteCount,
} from "./common.ts";
import { LinearTrack, MoveTrack, SpeedTrack } from "./sampling.ts";

/** Official time units per beat (the format divides a beat into 32 steps). */
const OFFICIAL_UNITS_PER_BEAT = 32;

/** Upper bound on grid samples per export before the step is coarsened. */
const MAX_OFFICIAL_GRID_SAMPLES = 120_000;

/** Upper bound on the complete sample set; beyond this the export refuses. */
const MAX_OFFICIAL_SAMPLES = 600_000;

/** One official note. */
interface OfficialNote {
  type: number;
  time: number;
  holdTime: number;
  positionX: number;
  speed: number;
  floorPosition: number;
}

/** One official linear move event. */
interface OfficialMoveEvent {
  startTime: number;
  endTime: number;
  start: number;
  end: number;
  start2: number;
  end2: number;
}

/** One official linear numeric event. */
interface OfficialNumericEvent {
  startTime: number;
  endTime: number;
  start: number;
  end: number;
}

/** One official constant speed event with its cumulative floor. */
interface OfficialSpeedEvent {
  startTime: number;
  endTime: number;
  value: number;
  floorPosition: number;
}

/** One official judge line. */
interface OfficialJudgeLine {
  bpm: number;
  notesAbove: OfficialNote[];
  notesBelow: OfficialNote[];
  speedEvents: OfficialSpeedEvent[];
  judgeLineMoveEvents: OfficialMoveEvent[];
  judgeLineRotateEvents: OfficialNumericEvent[];
  judgeLineDisappearEvents: OfficialNumericEvent[];
}

/** The document written by the official exporter. */
interface OfficialChart {
  formatVersion: 3;
  offset: number;
  judgeLineList: OfficialJudgeLine[];
}

/** A parsed source line before the common chart end is known. */
interface PendingLine {
  bpm: number;
  notes: JudgeLineNote[];
  layer: ReturnType<typeof emptyLayer>;
}

/** Collects unique warnings without letting a large chart flood the result. */
class WarningLog {
  private readonly seen = new Set<string>();
  readonly values: string[] = [];

  add(message: string): void {
    if (!this.seen.has(message)) {
      this.seen.add(message);
      this.values.push(message);
    }
  }
}

/** Decode a format-version-1 packed position into normalized X and Y. */
function decodeVersionOne(value: number): { x: number; y: number } {
  const x = Math.floor(value / 1000) / 880;
  const rawY = value % 1000;
  return { x, y: (rawY < 0 ? rawY + 1000 : rawY) / 520 };
}

/** Convert one official time value into an RPE beat at the selected base BPM. */
function officialTimeToBeat(time: number, lineBpm: number, baseBpm: number): number {
  return (time * baseBpm) / (OFFICIAL_UNITS_PER_BEAT * lineBpm);
}

/** Detect whether a chart stores note X as -9..9 or as 0..18. */
function officialNoteCenter(lines: readonly Record<string, unknown>[]): number {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const line of lines) {
    for (const key of ["notesAbove", "notesBelow"]) {
      const notes = line[key];
      if (!Array.isArray(notes)) {
        continue;
      }
      for (const note of notes) {
        if (!isRecord(note)) {
          continue;
        }
        const x = finiteNumber(note.positionX, Number.NaN);
        if (Number.isFinite(x)) {
          minimum = Math.min(minimum, x);
          maximum = Math.max(maximum, x);
        }
      }
    }
  }
  return minimum >= 0 && maximum > 9.5 ? 9 : 0;
}

/** Convert a value from one event into the RPE x/y range. */
function officialXToRpe(value: number): number {
  return -RPE_LINE_HALF_WIDTH + value * RPE_LINE_HALF_WIDTH * 2;
}

/** Convert a value from one event into the RPE y range. */
function officialYToRpe(value: number): number {
  return -RPE_LINE_HALF_HEIGHT + value * RPE_LINE_HALF_HEIGHT * 2;
}

/** Parse the notes from one official note list. */
function parseNotes(
  rawNotes: unknown,
  above: 1 | 2,
  center: number,
  timeToBeat: (time: number) => number,
  warnings: WarningLog,
): JudgeLineNote[] {
  const notes: JudgeLineNote[] = [];
  if (!Array.isArray(rawNotes)) {
    return notes;
  }
  for (const entry of rawNotes) {
    if (!isRecord(entry)) {
      continue;
    }
    const type = OFFICIAL_NOTE_TO_RPE[finiteNumber(entry.type, 0)];
    if (!type) {
      warnings.add("An official note type was not recognized and was skipped.");
      continue;
    }
    const start = timeToBeat(finiteNumber(entry.time, 0));
    const hold = finiteNumber(entry.holdTime, 0);
    const end = type === 2 ? timeToBeat(finiteNumber(entry.time, 0) + hold) : start;
    const x = (finiteNumber(entry.positionX, 0) - center) * RPE_UNITS_PER_OFFICIAL_X;
    const speed = Math.max(0, finiteNumber(entry.speed, 1));
    notes.push(makeNote(type, start, end, x, above, speed, 1, 0));
  }
  return notes;
}

/** Parse one official line into an RPE layer before the chart end is known. */
function parseLine(
  raw: Record<string, unknown>,
  formatVersion: number,
  baseBpm: number,
  center: number,
  warnings: WarningLog,
): PendingLine {
  const bpm = positiveNumber(raw.bpm, baseBpm);
  const toBeat = (time: number): number => officialTimeToBeat(time, bpm, baseBpm);
  const layer = emptyLayer();

  for (const entry of Array.isArray(raw.judgeLineMoveEvents) ? raw.judgeLineMoveEvents : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const startTime = toBeat(finiteNumber(entry.startTime, 0));
    const endTime = toBeat(finiteNumber(entry.endTime, 0));
    let startX: number;
    let endX: number;
    let startY: number;
    let endY: number;
    if (formatVersion === 1) {
      const start = decodeVersionOne(finiteNumber(entry.start, 0));
      const end = decodeVersionOne(finiteNumber(entry.end, 0));
      startX = start.x;
      endX = end.x;
      startY = start.y;
      endY = end.y;
    } else {
      startX = finiteNumber(entry.start, 0.5);
      endX = finiteNumber(entry.end, 0.5);
      startY = finiteNumber(entry.start2, 0.5);
      endY = finiteNumber(entry.end2, 0.5);
    }
    layer.moveXEvents!.push(
      makeEvent(startTime, endTime, officialXToRpe(startX), officialXToRpe(endX)),
    );
    layer.moveYEvents!.push(
      makeEvent(startTime, endTime, officialYToRpe(startY), officialYToRpe(endY)),
    );
  }

  for (const entry of Array.isArray(raw.judgeLineRotateEvents) ? raw.judgeLineRotateEvents : []) {
    if (!isRecord(entry)) {
      continue;
    }
    layer.rotateEvents!.push(
      makeEvent(
        toBeat(finiteNumber(entry.startTime, 0)),
        toBeat(finiteNumber(entry.endTime, 0)),
        -finiteNumber(entry.start, 0),
        -finiteNumber(entry.end, 0),
      ),
    );
  }

  for (const entry of Array.isArray(raw.judgeLineDisappearEvents)
    ? raw.judgeLineDisappearEvents
    : []) {
    if (!isRecord(entry)) {
      continue;
    }
    layer.alphaEvents!.push(
      makeEvent(
        toBeat(finiteNumber(entry.startTime, 0)),
        toBeat(finiteNumber(entry.endTime, 0)),
        finiteNumber(entry.start, 1) * 255,
        finiteNumber(entry.end, 1) * 255,
      ),
    );
  }

  for (const entry of Array.isArray(raw.speedEvents) ? raw.speedEvents : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const value = finiteNumber(entry.value, 1) * RPE_SPEED_PER_OFFICIAL_SPEED;
    layer.speedEvents!.push(
      makeEvent(
        toBeat(finiteNumber(entry.startTime, 0)),
        toBeat(finiteNumber(entry.endTime, 0)),
        value,
        value,
      ),
    );
  }

  const notes = [
    ...parseNotes(raw.notesAbove, 1, center, toBeat, warnings),
    ...parseNotes(raw.notesBelow, 2, center, toBeat, warnings),
  ];
  return { bpm, notes, layer };
}

/** Add one static event when a track is empty, so the line stays visible. */
function fillFallback(events: JudgeLineEvent[], value: number, endBeat: number): JudgeLineEvent[] {
  return events.length ? events : [makeEvent(0, Math.max(1, endBeat), value, value)];
}

/** Complete a pending line once the chart end is known. */
function finishLine(pending: PendingLine, index: number, endBeat: number): JudgeLine {
  const line = makeLine(`Line ${index + 1}`, index, pending.layer);
  line.eventLayers![0] = {
    moveXEvents: fillFallback(pending.layer.moveXEvents ?? [], 0, endBeat),
    moveYEvents: fillFallback(pending.layer.moveYEvents ?? [], 0, endBeat),
    rotateEvents: fillFallback(pending.layer.rotateEvents ?? [], 0, endBeat),
    alphaEvents: fillFallback(pending.layer.alphaEvents ?? [], 255, endBeat),
    speedEvents: fillFallback(
      pending.layer.speedEvents ?? [],
      1 * RPE_SPEED_PER_OFFICIAL_SPEED,
      endBeat,
    ),
  };
  line.notes = pending.notes;
  updateNoteCount(line);
  return line;
}

/** Parse one official chart object into a valid RPE chart. */
export function parseOfficialChart(
  value: unknown,
  metadata: ExternalChartMetadata = {},
): ConvertedExternalChart {
  if (!isRecord(value) || !Array.isArray(value.judgeLineList)) {
    throw new Error("The file is not a Phigros official chart.");
  }
  const formatVersion = finiteNumber(value.formatVersion, 3);
  if (formatVersion !== 1 && formatVersion !== 3) {
    throw new Error(`Unsupported Phigros formatVersion: ${formatVersion}`);
  }
  const rawLines = value.judgeLineList.filter(isRecord);
  const baseBpm = positiveNumber(rawLines[0]?.bpm, 120);
  const center = officialNoteCenter(rawLines);
  const warnings = new WarningLog();
  if (Array.isArray(value.blockAreaList) && value.blockAreaList.length) {
    warnings.add("Official blockAreaList (noise areas) was not imported.");
  }
  const pending = rawLines.map((line) => parseLine(line, formatVersion, baseBpm, center, warnings));
  let endBeat = 1;
  for (const line of pending) {
    for (const event of Object.values(line.layer)) {
      for (const entry of event ?? []) {
        endBeat = Math.max(endBeat, beatValue(entry.endTime));
      }
    }
    for (const note of line.notes) {
      endBeat = Math.max(endBeat, beatValue(note.endTime));
    }
  }
  const lines = pending.map((line, index) => finishLine(line, index, endBeat));
  const chart = makeChart(
    metadata,
    baseBpm,
    metadata.offsetMs ?? finiteNumber(value.offset, 0) * 1000,
    lines,
  );
  return { chart, warnings: warnings.values };
}

/** A sampled line's official-format builders. */
interface LineSampleBuilder {
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

/** Create the builders for every exported line. */
function createBuilders(chart: Chart, indices: readonly number[]): LineSampleBuilder[] {
  return indices.map((index) => ({
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
}

/** Add one sampled frame to every builder. */
function pushFrame(
  builder: LineSampleBuilder,
  time: number,
  seconds: number,
  state: { x: number; y: number; rotation: number; alpha: number; floor: number },
): void {
  builder.move.push(
    time,
    (state.x + RPE_LINE_HALF_WIDTH) / (RPE_LINE_HALF_WIDTH * 2),
    (state.y + RPE_LINE_HALF_HEIGHT) / (RPE_LINE_HALF_HEIGHT * 2),
  );
  builder.rotate.push(time, -state.rotation);
  builder.alpha.push(time, Math.min(1, Math.max(0, state.alpha / 255)));
  if (builder.first) {
    builder.first = false;
    builder.lastTime = time;
    builder.lastSeconds = seconds;
    builder.lastFloor = state.floor;
    return;
  }
  const duration = seconds - builder.lastSeconds;
  if (duration > 1e-9) {
    const speed = (state.floor - builder.lastFloor) / duration / RPE_PIXELS_PER_OFFICIAL_Y;
    builder.speed.push(
      builder.lastTime,
      time,
      speed,
      builder.lastFloor / RPE_PIXELS_PER_OFFICIAL_Y,
    );
  }
  builder.lastTime = time;
  builder.lastSeconds = seconds;
  builder.lastFloor = state.floor;
}

/** The maximum chart time in seconds, using each line's own BPM factor. */
function chartSeconds(chart: Chart, tempo: TempoMap): number {
  let maximum = 0;
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const event of Object.values(layer ?? {})) {
        for (const entry of event ?? []) {
          maximum = Math.max(maximum, tempo.seconds(entry.endTime));
        }
      }
    }
    for (const note of line.notes ?? []) {
      maximum = Math.max(maximum, tempo.seconds(note.endTime));
    }
  }
  return maximum;
}

/** Collect the sample times used by the exporter, in official time units. */
function sampleTimes(chart: Chart, tempo: TempoMap, baseBpm: number, maxUnits: number): number[] {
  const times = new Set<number>();
  const step = Math.max(1, Math.ceil(maxUnits / MAX_OFFICIAL_GRID_SAMPLES));
  for (let unit = 0; unit <= maxUnits; unit += step) {
    times.add(roundNumber(unit, 6));
  }
  times.add(roundNumber(maxUnits, 6));
  const add = (seconds: number): void => {
    if (Number.isFinite(seconds)) {
      times.add(roundNumber((seconds * baseBpm) / 1.875, 6));
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
  return [...times].sort((left, right) => left - right);
}

/** Export one RPE chart as a Phigros official chart. */
export function serializeOfficialChart(chart: Chart): SerializedExternalChart {
  const tempo = new TempoMap(chart.BPMList);
  const baseBpm = positiveNumber(tempo.points[0] ? 60 / tempo.points[0].secondsPerBeat : 120, 120);
  const lines = chart.judgeLineList ?? [];
  const warnings = new WarningLog();
  if (chart.blockAreaList?.length) {
    warnings.add("Noise areas (blockAreaList) are not exported to the official format.");
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
    warnings.add("Judge-line note control curves are not exported to the official format.");
  }
  if (lines.some((line) => Number(line.isCover ?? 1) !== 1)) {
    warnings.add("Judge-line masks are not exported to the official format.");
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
    warnings.add("Extended line events are not exported to the official format.");
  }
  const indices = lines
    .map((line, index) => ({ line, index, traits: judgeLineTraits(line) }))
    .filter(({ line, traits }) => {
      if (traits.purpose !== "standard") {
        warnings.add(`A ${traits.purpose} line was not exported to the official format.`);
        return false;
      }
      if (line.attachUI) {
        warnings.add("UI-bound lines were not exported to the official format.");
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        Number(left.line.zOrder ?? 0) - Number(right.line.zOrder ?? 0) || left.index - right.index,
    )
    .map(({ index }) => index);

  if (!indices.length) {
    return {
      text: JSON.stringify({
        formatVersion: 3,
        offset: roundNumber(finiteNumber(chart.META.offset, 0) / 1000, 6),
        judgeLineList: [],
      } satisfies OfficialChart),
      warnings: warnings.values,
    };
  }

  const maxSeconds = chartSeconds(chart, tempo);
  const maxUnits = Math.max(1, (maxSeconds * baseBpm) / 1.875);
  const times = sampleTimes(chart, tempo, baseBpm, maxUnits);
  if (times.length > MAX_OFFICIAL_SAMPLES) {
    throw new Error(
      `The chart needs ${times.length} samples to export to the official format; the limit is ${MAX_OFFICIAL_SAMPLES}.`,
    );
  }

  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const builders = createBuilders(chart, indices);
  for (const time of times) {
    const seconds = (time * 1.875) / baseBpm;
    const states = scene.sample(seconds);
    for (const builder of builders) {
      const state = states[builder.index];
      if (state) {
        pushFrame(builder, time, seconds, state);
      }
    }
  }

  const officialLines: OfficialJudgeLine[] = indices.map((index, outputIndex) => {
    const builder = builders[outputIndex];
    const line = lines[index]!;
    const runtime = scene.lines[index]!;
    const notesAbove: OfficialNote[] = [];
    const notesBelow: OfficialNote[] = [];
    for (const note of line.notes ?? []) {
      const type = RPE_NOTE_TO_OFFICIAL[note.type];
      if (!type) {
        warnings.add("A note with an unknown type was skipped.");
        continue;
      }
      if (Number(note.isFake ?? 0) === 1) {
        warnings.add("Fake notes were skipped because the official format has no fake flag.");
        continue;
      }
      if (Number(note.size ?? 1) !== 1 || Number(note.alpha ?? 255) !== 255) {
        warnings.add("Note size and opacity are not exported to the official format.");
      }
      if (Number(note.yOffset ?? 0) !== 0) {
        warnings.add("Note Y offset is not exported to the official format.");
      }
      if (Number(note.visibleTime ?? 999999) !== 999999) {
        warnings.add("Note visible time is not exported to the official format.");
      }
      const start = tempo.seconds(note.startTime);
      const end = tempo.seconds(note.endTime);
      const official: OfficialNote = {
        type,
        time: roundNumber((start * baseBpm) / 1.875, 6),
        holdTime: roundNumber((Math.max(0, end - start) * baseBpm) / 1.875, 6),
        positionX: roundNumber(Number(note.positionX ?? 0) / RPE_UNITS_PER_OFFICIAL_X, 6),
        speed: roundNumber(Math.max(0, finiteNumber(note.speed, 1)), 6),
        floorPosition: roundNumber(runtime.floor(start) / RPE_PIXELS_PER_OFFICIAL_Y, 6),
      };
      (noteIsAbove(note) ? notesAbove : notesBelow).push(official);
    }
    return {
      bpm: roundNumber(baseBpm, 6),
      notesAbove,
      notesBelow,
      speedEvents: builder.speed.result(),
      judgeLineMoveEvents: builder.move.result(),
      judgeLineRotateEvents: builder.rotate.result(),
      judgeLineDisappearEvents: builder.alpha.result(),
    };
  });

  const official: OfficialChart = {
    formatVersion: 3,
    offset: roundNumber(finiteNumber(chart.META.offset, 0) / 1000, 6),
    judgeLineList: officialLines,
  };
  return { text: JSON.stringify(official), warnings: warnings.values };
}
