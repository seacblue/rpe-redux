/** Verifies the throttled playback clock subscription and its disposer. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPlaybackSubscriptions,
  playback,
  subscribePlaybackForOwner,
} from "../../../core/api/playback.ts";
import { connectPlaybackApi } from "../../../core/edit/playback/api.ts";

function fakeHost() {
  const state = {
    loaded: true,
    playing: true,
    pending: false,
    audioSeconds: 1.5,
    chartSeconds: 1.5,
    beat: 3,
    duration: 10,
    rate: 1,
    offsetSeconds: 0,
    lineIndex: 0,
  };
  return {
    chart: () => ({ judgeLineList: [] }),
    tempo: () => ({ seconds: () => 0, beat: () => 0 }),
    state: () => state,
    play: async () => {},
    pause: () => {},
    seek: () => {},
    setRate: () => {},
    render: () => {},
    textures: () => [],
    metrics: {
      start() {},
      stop() {
        return {};
      },
      report() {
        return {};
      },
    },
    stateValue: state,
  };
}

test("playback.subscribe delivers an immediate tick and stops on dispose", async () => {
  const host = fakeHost();
  const disconnect = connectPlaybackApi(host);
  const ticks = [];
  try {
    const stop = playback.subscribe(
      (tick) => {
        ticks.push(tick);
      },
      { maxHz: 60 },
    );
    assert.equal(ticks.length, 1);
    assert.deepEqual(ticks[0], {
      chartSeconds: 1.5,
      beat: 3,
      playing: true,
      rate: 1,
      lineIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.ok(ticks.length > 1);
    stop();
    const afterStop = ticks.length;
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.equal(ticks.length, afterStop);
  } finally {
    disconnect();
  }
});

test("playback.subscribe without a runtime is a no-op disposer", () => {
  let calls = 0;
  const stop = playback.subscribe(() => {
    calls += 1;
  });
  assert.equal(typeof stop, "function");
  stop();
  assert.equal(calls, 0);
});

test("owner cleanup stops only that owner's playback subscriptions", async () => {
  const host = fakeHost();
  const disconnect = connectPlaybackApi(host);
  let first = 0;
  let second = 0;
  try {
    subscribePlaybackForOwner(
      "owner.a",
      () => {
        first += 1;
      },
      { maxHz: 60 },
    );
    const stopSecond = subscribePlaybackForOwner(
      "owner.b",
      () => {
        second += 1;
      },
      { maxHz: 60 },
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    clearPlaybackSubscriptions("owner.a");
    const firstAfter = first;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(first, firstAfter);
    assert.ok(second > 1);
    stopSecond();
  } finally {
    clearPlaybackSubscriptions();
    disconnect();
  }
});
