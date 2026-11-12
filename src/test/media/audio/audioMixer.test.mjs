/** The shared audio mixer persists four buses and fans them out to active owners. */
import assert from "node:assert/strict";
import test from "node:test";
import "../../../core/settings/features/audio.ts";
import { audioMixer } from "../../../core/media/audioMixer.ts";
import { values } from "../../../core/state/values.ts";

const METER_IDS = ["master-volume", "volume", "effect-volume", "hitsound-volume"];

test("audio mixer applies persisted buses to owners and keeps snapshots stable", () => {
  const previous = new Map(METER_IDS.map((id) => [id, values.byId.get(id)]));
  const applied = [];
  const remove = audioMixer.registerOwner({
    setMasterVolume: (value) => applied.push(["master", value]),
    setMusicVolume: (value) => applied.push(["music", value]),
    setEffectVolume: (value) => applied.push(["effect", value]),
    setHitsoundVolume: (value) => applied.push(["hitsound", value]),
  });
  try {
    const first = audioMixer.snapshot();
    assert.equal(first, audioMixer.snapshot());
    values.byId.set("master-volume", "0.4");
    assert.equal(applied.at(-1)?.[0], "hitsound");
    assert.equal(applied.filter(([meter]) => meter === "master").at(-1)?.[1], 0.4);
    assert.equal(audioMixer.snapshot().values.master, 0.4);
  } finally {
    remove();
    for (const [id, value] of previous) {
      values.byId.set(id, value);
    }
  }
});

test("audio mixer reveals before the first adjustment and toggles master mute", () => {
  const previous = values.byId.get("master-volume");
  try {
    values.byId.set("master-volume", "0.8");
    audioMixer.show();
    audioMixer.toggleMute();
    assert.equal(audioMixer.snapshot().muted, true);
    audioMixer.toggleMute();
    assert.equal(audioMixer.snapshot().values.master, 0.8);
  } finally {
    values.byId.set("master-volume", previous);
  }
});

test("audio mixer preserves per-kind hit-sound levels behind the global bus", async () => {
  const { HitSounds } = await import("../../../core/media/hitsounds.ts");
  const transport = { ensureContext() {}, effectGain: null, backgroundGain: null };
  const sounds = new HitSounds(transport);
  sounds.setSoundVolume("tap", 0.25);
  sounds.setMasterVolume(0.5);
  assert.equal(sounds.soundVolumes.tap, 0.25);
  assert.equal(sounds.volume, 0.5);
  sounds.dispose();
});
