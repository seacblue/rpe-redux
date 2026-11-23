/**
 * The tempo map: conversion between beats and seconds across a chart's `BPMList`.
 *
 * Construction validates and sorts tempo points once, so later reads are pure
 * lookups. Every chart time is measured against this one map; a judge line's
 * `bpmfactor` is not a time scale and never reaches these conversions.
 */
import { t } from "../../../../i18n/index.ts";
import { beatValue } from "./beat.ts";
import { upperBound } from "../../../utils/search.ts";

/** One `BPMList` entry: a tempo in beats per minute starting at `startTime`. */
export interface TempoEntry {
  bpm: number;
  startTime: number[];
  [extra: string]: unknown;
}

/** A validated tempo point with its beat and elapsed seconds. */
interface TempoPoint {
  beat: number;
  secondsPerBeat: number;
  seconds: number;
}

/** Beat/second conversion for a sorted, validated `BPMList`. */
export class TempoMap {
  declare points: TempoPoint[];

  /** Validate and sort `entries`, precomputing each point's elapsed seconds. */
  constructor(entries: readonly TempoEntry[]) {
    if (!Array.isArray(entries) || !entries.length) {
      throw new Error(t("model.tempo.emptyList"));
    }
    this.points = entries
      .map((entry, index) => {
        if (!Number.isFinite(entry.bpm) || entry.bpm <= 0) {
          throw new Error(t("model.tempo.invalidBpm", { index }));
        }
        return {
          beat: beatValue(entry.startTime, `BPMList[${index}].startTime`),
          secondsPerBeat: 60 / entry.bpm,
          seconds: 0,
        };
      })
      .sort((left, right) => left.beat - right.beat);
    let previousBeat = 0;
    let previousSeconds = 0;
    let previousRate = this.points[0].secondsPerBeat;
    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      point.seconds = previousSeconds + (point.beat - previousBeat) * previousRate;
      previousBeat = point.beat;
      previousSeconds = point.seconds;
      previousRate = point.secondsPerBeat;
    }
  }

  /** Chart seconds at `beat`, accepting a number or beat tuple. */
  seconds(beat: number | readonly number[]): number {
    const beatTuple: readonly number[] = Array.isArray(beat) ? beat : [beat];
    const value = Array.isArray(beat) ? beatValue(beatTuple) : Number(beat);
    if (!Number.isFinite(value)) {
      throw new Error(t("model.tempo.invalidTime"));
    }
    const point =
      this.points[Math.max(0, upperBound(this.points, value, (entry) => entry.beat) - 1)];
    return point.seconds + (value - point.beat) * point.secondsPerBeat;
  }

  /** Beat position at chart time `seconds`. */
  beat(seconds: number): number {
    if (!Number.isFinite(seconds)) {
      throw new Error(t("model.tempo.invalidTime"));
    }
    const point =
      this.points[Math.max(0, upperBound(this.points, seconds, (entry) => entry.seconds) - 1)];
    return point.beat + (seconds - point.seconds) / point.secondsPerBeat;
  }
}
