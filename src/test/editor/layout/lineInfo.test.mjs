/** Verifies the RPE-compatible judge-line readout and its default shortcut. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { EDITOR_SHORTCUTS } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { matches } from "../../../core/shortcuts/keyMatching.ts";
import { registerDeferredCatalogs } from "../../../i18n/deferred.ts";
import {
  buildLineInfoPresentation,
  buildLineInfoText,
} from "../../../frontend/screens/editor/workspace/stage/lineInfo/lineInfoPresenter.ts";

registerDeferredCatalogs();

test("line info uses authored line values and per-frame deltas", () => {
  const chart = createChart();
  const line = createLine("Readout");
  line.eventLayers[0].moveXEvents = [createEvent(0, 120, 0, 1)];
  line.eventLayers[0].moveYEvents = [createEvent(0, -2461.02, 0, 1)];
  line.eventLayers[0].rotateEvents = [createEvent(0, 90, 0, 1)];
  line.eventLayers[0].alphaEvents = [createEvent(255, 255, 0, 1)];
  line.eventLayers[0].speedEvents = [createEvent(9.9, 9.9, 0, 1)];
  chart.judgeLineList = [line];

  const text = buildLineInfoText(
    new SceneRuntime(),
    chart,
    0,
    0.25,
    new TempoMap(chart.BPMList),
    0.25 - 1 / 60,
  );

  assert.match(text, /60\.00/);
  assert.match(text, /-1230\.5/);
  assert.doesNotMatch(text, /-1230\.51/);
  assert.match(text, /45\.00/);
  assert.match(text, /255/);
  assert.match(text, /Pos: \(60\.00, -1230\.5\)/);
  assert.match(text, /Dir: 45\.00/);
  assert.match(text, /Alpha: 255/);
  assert.match(text, /Speed: 9\.9/);
  assert.match(text, /X Y R Speed:/);
  assert.match(text, /4\.00, -82, 3\.00/);

  const presentation = buildLineInfoPresentation(
    new SceneRuntime(),
    chart,
    0,
    0.25,
    new TempoMap(chart.BPMList),
    0.25 - 1 / 60,
  );
  assert.deepEqual(
    presentation.layout.rows.flat().filter((token) => token.kind !== "text"),
    [
      { text: "60.00", kind: "coordinate" },
      { text: "-1230.5", kind: "coordinate" },
      { text: "45.00", kind: "angle" },
      { text: "255", kind: "alpha" },
      { text: "9.9", kind: "speed" },
      { text: "4.00", kind: "velocity" },
      { text: "-82", kind: "velocity" },
      { text: "3.00", kind: "velocity" },
    ],
  );
});

test("line info follows RPE's Tab default", () => {
  const definition = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "view.showLineInfo");
  assert.deepEqual(definition?.defaults, [{ key: "TAB" }]);
  assert.equal(matches({ key: "Tab" }, definition.defaults[0]), true);
});
