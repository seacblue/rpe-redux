/** Hit-sound lifetime: a long effect may finish after the music reaches its end. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { HitSounds } from "../../core/media/hitsounds.ts";

/** Create the smallest transport double needed by the hit-sound player. */
function transportStub() {
  let stopped = false;
  const source = {
    connect() {},
    disconnect() {},
    start() {},
    stop() {
      stopped = true;
    },
  };
  const gain = {
    gain: { value: 0 },
    connect() {},
    disconnect() {},
  };
  const transport = {
    playing: true,
    clockReady: true,
    playRevision: 0,
    rate: 1,
    audioTime: 1.9,
    duration: 2,
    scheduleHorizon: Infinity,
    context: {
      currentTime: 0,
      destination: {},
      createGain: () => gain,
      createBufferSource: () => source,
      decodeAudioData: async () => ({ length: 1, numberOfChannels: 1, duration: 8 }),
    },
    backgroundGain: null,
    ensureContext() {
      return this.context;
    },
  };
  return { transport, wasStopped: () => stopped };
}

test("prepare preloads a custom sound even when its first note is later in the chart", async () => {
  const { transport } = transportStub();
  const chart = createChart();
  chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }];
  chart.judgeLineList[0].notes = [{ ...createNote(1, 100, 0), hitSound: "long.ogg" }];
  const hits = new HitSounds(transport);
  hits.setProject(chart, new Map([["long.ogg", new Uint8Array([1, 2, 3])]]), "chart.json");

  await hits.prepare();

  assert.equal(hits.buffers.has("long.ogg"), true);
});

test("a long hit sound is not stopped when the music reaches its end", () => {
  const { transport, wasStopped } = transportStub();
  const hits = new HitSounds(transport);
  hits.gain = {};
  hits.playEntry({ time: 1.9, sound: "tap" }, { duration: 8 });

  transport.playing = false;
  transport.audioTime = transport.duration;
  hits.tick({ judgeLineList: [], META: {} }, { seconds: () => 0 }, 0);

  assert.equal(wasStopped(), false);
});

test("a hit sound still stops when playback is paused before the music ends", () => {
  const { transport, wasStopped } = transportStub();
  const hits = new HitSounds(transport);
  hits.gain = {};
  hits.playEntry({ time: 1.9, sound: "tap" }, { duration: 8 });

  transport.playing = false;
  transport.audioTime = 1.5;
  hits.tick({ judgeLineList: [], META: {} }, { seconds: () => 0 }, 0);

  assert.equal(wasStopped(), true);
});
