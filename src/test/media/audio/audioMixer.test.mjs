/** The sidebar audio console writes the existing music and per-object hitsound settings. */
import assert from "node:assert/strict";
import test from "node:test";
import "../../../core/settings/features/audio.ts";
import { audioMixer } from "../../../core/media/audioMixer.ts";
import { values } from "../../../core/state/values.ts";

const METER_IDS = ["volume", "hitsound-tap", "hitsound-drag", "hitsound-flick", "hitsound-custom"];

test("audio mixer applies existing settings to owners and keeps snapshots stable", () => {
  const previous = new Map(METER_IDS.map((id) => [id, values.byId.get(id)]));
  const applied = [];
  const remove = audioMixer.registerOwner({
    setMusicVolume: (value) => applied.push(["music", value]),
  });
  try {
    const first = audioMixer.snapshot();
    assert.equal(first, audioMixer.snapshot());
    audioMixer.set("music", 0.4);
    assert.equal(applied.at(-1)?.[0], "music");
    assert.equal(applied.at(-1)?.[1], 0.4);
    assert.equal(audioMixer.snapshot().values.music, 0.4);
  } finally {
    remove();
    for (const [id, value] of previous) {
      values.byId.set(id, value);
    }
  }
});

test("audio mixer changes each existing hitsound setting", () => {
  const previous = new Map(METER_IDS.slice(1).map((id) => [id, values.byId.get(id)]));
  try {
    audioMixer.set("drag", 0.8);
    assert.equal(audioMixer.snapshot().values.drag, 0.8);
  } finally {
    for (const [id, value] of previous) {
      values.byId.set(id, value);
    }
  }
});

test("audio mixer effects control updates every existing hitsound setting", () => {
  const previous = new Map(METER_IDS.slice(1).map((id) => [id, values.byId.get(id)]));
  try {
    audioMixer.setEffects(0.6);
    for (const id of METER_IDS.slice(1)) {
      assert.equal(values.byId.get(id), "0.6");
    }
  } finally {
    for (const [id, value] of previous) {
      values.byId.set(id, value);
    }
  }
});

test("hit sounds keep their existing per-kind volume path", async () => {
  const { HitSounds } = await import("../../../core/media/hitsounds.ts");
  const transport = { ensureContext() {}, backgroundGain: null };
  const sounds = new HitSounds(transport);
  sounds.setSoundVolume("tap", 0.25);
  assert.equal(sounds.soundVolumes.tap, 0.25);
  assert.equal(sounds.volume, 0.3);
  sounds.dispose();
});
