/** Home audio keeps playback alive while its background gain changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { LibraryPreviewAudio } from "../../../frontend/screens/welcome/library/libraryPreviewAudio.ts";

class FakeParam {
  value = 0;
  ramps = [];
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
  setValueAtTime(value) {
    this.value = value;
  }
  linearRampToValueAtTime(value, time) {
    this.ramps.push({ value, time });
  }
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
}
class FakeContext {
  static instances = [];
  currentTime = 10;
  state = "running";
  destination = {};
  gains = [];
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource() {
    return { connect() {} };
  }
  close() {
    return Promise.resolve();
  }
}
class FakeAudio {
  static instances = [];
  paused = true;
  volume = 0;
  src = "";
  currentTime = 0;
  duration = 120;
  constructor() {
    FakeAudio.instances.push(this);
  }
  addEventListener() {}
  pause() {
    this.paused = true;
  }
  removeAttribute(name) {
    if (name === "src") {
      this.src = "";
    }
  }
  load() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
}

test("preview seeking moves the active track by five seconds and clamps at its ends", async () => {
  const previous = { Audio: globalThis.Audio, AudioContext: globalThis.AudioContext };
  FakeAudio.instances = [];
  FakeContext.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.AudioContext = FakeContext;
  try {
    const player = new LibraryPreviewAudio(() => {});
    player.select({
      key: "project:seek",
      audio: { name: "seek.ogg", url: "http://localhost/seek" },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const audio = FakeAudio.instances[0];
    audio.currentTime = 10;
    player.seekBy(5);
    assert.equal(audio.currentTime, 15);
    player.seekBy(-50);
    assert.equal(audio.currentTime, 0);
    player.seekBy(200);
    assert.equal(audio.currentTime, 120);
    player.dispose();
  } finally {
    globalThis.Audio = previous.Audio;
    globalThis.AudioContext = previous.AudioContext;
  }
});

test("background volume fades without stopping or restarting the preview", async () => {
  const previous = { Audio: globalThis.Audio, AudioContext: globalThis.AudioContext };
  FakeAudio.instances = [];
  FakeContext.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.AudioContext = FakeContext;
  try {
    const player = new LibraryPreviewAudio(() => {});
    const entry = { key: "project:a", audio: { name: "song.ogg", url: "http://localhost/song" } };
    player.select(entry);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const audio = FakeAudio.instances[0];
    const master = FakeContext.instances[0].gains[0].gain;
    assert.equal(audio.paused, false);
    assert.equal(audio.crossOrigin, "anonymous");
    player.setBackgroundVolume(0.4);
    assert.deepEqual(master.ramps.at(-1), { value: 0.4, time: 10.36 });
    assert.equal(audio.paused, false);
    assert.equal(audio.src, entry.audio.url);
    player.setBackgroundVolume(1);
    assert.deepEqual(master.ramps.at(-1), { value: 1, time: 10.36 });
    player.select(entry);
    assert.equal(audio.paused, false);
    player.dispose();
    assert.equal(audio.paused, true);
  } finally {
    globalThis.Audio = previous.Audio;
    globalThis.AudioContext = previous.AudioContext;
  }
});

test("rapid selection starts only the final preview", async () => {
  const previous = { Audio: globalThis.Audio, AudioContext: globalThis.AudioContext };
  FakeAudio.instances = [];
  FakeContext.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.AudioContext = FakeContext;
  try {
    const player = new LibraryPreviewAudio(() => {});
    player.select({ key: "project:a", audio: { name: "a.ogg", url: "http://localhost/a" } });
    player.select({ key: "project:b", audio: { name: "b.ogg", url: "http://localhost/b" } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      FakeAudio.instances.some((audio) => audio.src === "http://localhost/a"),
      false,
    );
    assert.equal(
      FakeAudio.instances.some((audio) => audio.src === "http://localhost/b"),
      true,
    );
    player.dispose();
  } finally {
    globalThis.Audio = previous.Audio;
    globalThis.AudioContext = previous.AudioContext;
  }
});
