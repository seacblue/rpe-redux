/** Focused contracts for cached trajectory plot sampling. */
import assert from "node:assert/strict";
import test from "node:test";
import { createEvent } from "../../../core/global/chart/chart.ts";
import { trajectoryEventValue } from "../../../core/global/chart/trajectory/curveTrajectory.ts";
import { trajectoryPlotSamplesFor } from "../../../frontend/screens/editor/workspace/timeline/events/eventOverlayDrawing.ts";

/** Create a deterministic trajectory event for render-path comparisons. */
function createTrajectoryEvent() {
  const event = createEvent(0, 0, 0, 4);
  event.trajectory = {
    version: 1,
    segments: 8,
    options: {
      mode: "parametric",
      xExpression: "200 * cos(2 * pi * t)",
      yExpression: "120 * sin(2 * pi * t)",
      parameterStart: "0",
      parameterEnd: "1",
    },
  };
  return event;
}

test("cached trajectory samples match the unoptimized per-frame evaluator", () => {
  const event = createTrajectoryEvent();
  for (const axis of ["x", "y"]) {
    const expected = Array.from({ length: 65 }, (_, index) =>
      trajectoryEventValue(event, index / 64, axis),
    );
    const actual = trajectoryPlotSamplesFor(event, axis);

    assert.deepEqual([...actual.values], expected);
    assert.equal(actual.minimum, Math.min(...expected));
    assert.equal(actual.maximum, Math.max(...expected));
    assert.strictEqual(trajectoryPlotSamplesFor(event, axis), actual);
  }
});

test("trajectory axes keep independent cached sample arrays", () => {
  const event = createTrajectoryEvent();
  const x = trajectoryPlotSamplesFor(event, "x");
  const y = trajectoryPlotSamplesFor(event, "y");

  assert.notStrictEqual(x, y);
  assert.notStrictEqual(x.values, y.values);
  assert.equal(x.values.length, 65);
  assert.equal(y.values.length, 65);
});
