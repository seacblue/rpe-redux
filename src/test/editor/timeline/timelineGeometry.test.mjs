/** Verifies pointer projection stays stable across a timeline relayout during a drag. */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue } from "../../../core/state/values.ts";
import {
  multiLineViewportOffset,
  panMultiLine,
  point,
} from "../../../frontend/screens/editor/workspace/timeline/viewport/timelineGeometry.ts";

function pointer(clientX, clientY) {
  return { clientX, clientY };
}

test("a drag keeps its pointer coordinates when the canvas relayouts", () => {
  let rectangle = { left: 36, top: 131 };
  const canvas = {
    getBoundingClientRect: () => rectangle,
  };
  const receiver = { notesCanvas: canvas };
  const dragFrame = { left: rectangle.left, top: rectangle.top };
  const start = point.call(receiver, pointer(198, 578), canvas, dragFrame);

  rectangle = { left: 128, top: 131 };

  assert.deepEqual(point.call(receiver, pointer(198, 578), canvas, dragFrame), start);
});

test("multi-line panning publishes the CSS panel offset", () => {
  const snapshot = createValue({
    initial: { visible: true, max: "400", value: "0" },
  });
  const receiver = {
    multiLineScroll: { notes: 0, events: 0 },
    multiLineScrollState: { snapshot },
    panelLayout: () => ({ active: true, count: 4, widthRatio: 0.25, gapRatio: 0.04 }),
    multiLineViewportOffset,
  };

  const next = panMultiLine.call(receiver, 400, 20, "notes");

  assert.equal(snapshot.get().value, String(next));
});
