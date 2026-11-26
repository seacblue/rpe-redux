/** Timeline interaction regressions that must not move playback while a surface is hidden. */
import assert from "node:assert/strict";
import test from "node:test";
import { autoScroll } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineInteraction.ts";

test("a hidden timeline does not auto-scroll an active note drag", () => {
  const seekDeltas = [];
  const drag = {
    kind: "move",
    current: { x: 0, y: 240 },
    scrolled: false,
  };
  const receiver = {
    gestures: {
      drag,
      eventInteraction: { drag: null },
      onDragScroll: (seconds) => seekDeltas.push(seconds),
    },
    viewport: {
      scale: 1,
      viewHeight: () => 0,
    },
    changed() {},
  };

  autoScroll.call(receiver, 1 / 60);

  assert.deepEqual(seekDeltas, []);
  assert.equal(drag.scrolled, false);
});
