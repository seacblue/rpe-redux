/** PhiEditer preference mapping used by the folder import review. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPeMigrationPlan, peChartMediaNames } from "../../../core/migration/pe.ts";

const FIXTURE_ROOT = new URL("../../fixtures/pe/", import.meta.url);
const SETTINGS = readFileSync(new URL("Settings.txt", FIXTURE_ROOT), "utf8");

test("PE preferences map to the settings the editor owns", () => {
  const plan = createPeMigrationPlan(SETTINGS);
  const values = Object.fromEntries(plan.settings.map((write) => [write.key, write.value]));
  assert.deepEqual(values, {
    volume: "0.6",
    "hitsound-tap": "0.5",
    "hitsound-drag": "0.5",
    "hitsound-flick": "0.5",
    "hitsound-custom": "0.5",
    "scroll-speed": "5.6",
    "timeline-grid-count": "31",
  });
  assert.equal(plan.shortcuts.length, 0);
  assert.equal(plan.hotkeys.entries.length, 0);
  assert.equal(plan.unmapped.length, 0);
  assert.equal(plan.language, null);
});

test("PE preferences clamp into their control ranges", () => {
  const plan = createPeMigrationPlan(
    "BGMVolume: 1.5\nSEVolume: -1\nMouseScrollSpeed: 500\nAnchorLineAmount: 0\n",
  );
  const values = Object.fromEntries(plan.settings.map((write) => [write.key, write.value]));
  assert.equal(values.volume, "1");
  assert.equal(values["hitsound-tap"], "0");
  assert.equal(values["scroll-speed"], "100");
  assert.equal(values["timeline-grid-count"], "1");
});

test("unknown or missing PE preferences write nothing", () => {
  const plan = createPeMigrationPlan("LineWidth: 0.5\nNoteSize: 0.500\n");
  assert.deepEqual(plan.settings, []);
  assert.deepEqual(createPeMigrationPlan(null).settings, []);
  assert.deepEqual(createPeMigrationPlan("BGMVolume: loud").settings, []);
});

test("PE media names prefer the indexed file name and fall back to paths", () => {
  assert.deepEqual(
    peChartMediaNames({
      song: "one.mp3",
      picture: "one.jpg",
      songPath: "D:/PE/Resources/one.mp3",
      picturePath: "D:/PE/Resources/one.jpg",
    }),
    { song: "one.mp3", picture: "one.jpg" },
  );
  assert.deepEqual(
    peChartMediaNames({
      songPath: "D:/PE/Resources/loose.ogg",
      picturePath: "D:\\PE\\Resources\\loose.png",
    }),
    { song: "loose.ogg", picture: "loose.png" },
  );
  assert.deepEqual(peChartMediaNames({ song: "one.mp3" }), { song: "one.mp3" });
  assert.deepEqual(peChartMediaNames({ song: "", picture: "", songPath: "", picturePath: "" }), {});
});
