/** Verify adaptive recovery changes only optional GPU quality work. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorRenderScheduler } from "../../../frontend/screens/editor/workspace/runtime/frame/renderScheduler.ts";

function request(reducedQuality) {
  return {
    now: 0,
    seconds: 0,
    playing: true,
    previewVisible: true,
    previewHighDensity: true,
    contentRefreshRate: 144,
    reducedQuality,
    timelineRevision: 1,
    viewportOrigin: 0,
    previewChart: {},
    previewRevision: 0,
    previewSession: null,
    previewSelection: null,
    authoringRegionVisible: false,
  };
}

test("adaptive preview quality leaves logical work intact", () => {
  const scheduler = new EditorRenderScheduler();
  const seen = [];
  const adapter = { paint: (_request, work) => seen.push(work) };

  scheduler.tick(request(false), adapter);
  scheduler.tick(
    {
      ...request(true),
      now: 7,
      seconds: 0.007,
    },
    adapter,
  );

  assert.equal(seen.length, 2);
  assert.equal(seen[0].notePixelRatioScale, 1);
  assert.equal(seen[1].notePixelRatioScale, 0.8);
  assert.equal(seen[1].maxHitEffects, 0);
  assert.equal(seen[1].timeline, false);
  assert.equal(seen[1].playhead, true);
  assert.equal(seen[1].preview, true);
});
