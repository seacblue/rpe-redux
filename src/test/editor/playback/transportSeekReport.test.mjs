/**
 * Regression: the playhead must not move when playback stops.
 *
 * The playhead's screen row is
 *
 *   row = height - judgementOffset - (seconds(beat) - seconds(origin)) * scale
 *
 * so it is pinned only while `beat` (the chart time being drawn) and `origin`
 * (the viewport anchor published by playback) describe the same instant.
 *
 * During playback both come from `updatePlaybackViewportOrigin`, which republishes
 * the origin from the frame's own beat, so they agree. When playback stops the
 * transport freezes `position` at the authoritative audio time while nothing
 * republishes the origin. The frame before had drawn the interpolated visual time,
 * which runs up to one display frame ahead of the authoritative one, so the grid
 * kept the interpolated anchor and the playhead snapped back to the sample.
 *
 * `EditorPlayback.pause()` now reports a seek, which re-anchors both.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorPlayback } from "../../../core/edit/playback/transport.ts";

/** A transport stub whose frozen position drifts from the drawn time. */
function createAudio(state) {
  return {
    playing: false,
    position: 11,
    /** The authoritative time a pause would freeze. */
    get time() {
      return this.playing ? state.drawn : this.position;
    },
    play() {
      this.playing = true;
      return Promise.resolve();
    },
    pause() {
      this.position = this.time;
      this.playing = false;
    },
    seek(seconds) {
      this.position = seconds;
    },
  };
}

test("pause republishes the viewport origin at the held position", () => {
  // `drawn` is ahead of the frozen position by the interpolation lead, exactly
  // as the visual clock is.
  const state = { drawn: 11.012 };
  const audio = createAudio(state);
  const reasons = [];
  const playback = new EditorPlayback(
    audio,
    { chart: null, prepare: async () => {}, stop: () => {} },
    (reason) => {
      reasons.push(reason);
    },
  );

  audio.playing = true;
  state.drawn = 11.012;
  playback.pause();

  assert.equal(audio.playing, false, "pause must stop the transport");
  assert.equal(audio.position, 11.012, "pause freezes the authoritative position");
  assert.deepEqual(reasons, ["pause"], "pause must publish one held report");
});

test("seek publishes one report with its final position", () => {
  const state = { drawn: 11 };
  const audio = createAudio(state);
  const reasons = [];
  const playback = new EditorPlayback(
    audio,
    { chart: null, prepare: async () => {}, stop: () => {} },
    (reason) => {
      reasons.push(reason);
    },
  );

  playback.seek(20);

  assert.equal(audio.position, 20);
  assert.deepEqual(reasons, ["seek"], "a seek releases the hold and reports once");
});

test("toggle pauses a running transport and reports the hold", async () => {
  const state = { drawn: 12.5 };
  const audio = createAudio(state);
  const reasons = [];
  const playback = new EditorPlayback(
    audio,
    { chart: null, prepare: async () => {}, stop: () => {} },
    (reason) => {
      reasons.push(reason);
    },
  );

  audio.playing = true;
  await playback.toggle({ judgeLineList: [] });

  assert.equal(audio.playing, false);
  assert.deepEqual(reasons, ["pause"]);
});
