/**
 * Ctrl+wheel line stepping outside multi-line editing visits every chart line,
 * while multi-line editing keeps the step inside its set in authored order.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { LineSwitcher } from "../../../frontend/screens/editor/workspace/timeline/lineSwitcher/lineSwitcher.ts";

/** A switcher over a chart that remembers the active line its steps select. */
function switcherWithLines(count, initial, context) {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: count }, (_, index) => createLine(`L${index}`));
  const active = { selected: initial, picked: [] };
  const switcher = new LineSwitcher(
    { clientWidth: 0, clientHeight: 0 },
    () => ({
      chart,
      tempo: { seconds: () => 0 },
      seconds: 0,
      start: 0,
      end: 0,
      visible: true,
      selected: active.selected,
      ...context,
    }),
    {
      stepSelect: (index) => {
        active.selected = index;
        active.picked.push(index);
        return true;
      },
    },
  );
  return { switcher, active };
}

test("without multi-line editing the step visits every chart line", () => {
  const { switcher, active } = switcherWithLines(4, 1, {});

  switcher.step(1);
  switcher.step(1);
  switcher.step(1);

  assert.deepEqual(active.picked, [2, 3, 0]);
});

test("multi-line editing steps through its set in authored order", () => {
  // The written order is 2, 9, 6; the wheel follows that order.
  const { switcher, active } = switcherWithLines(12, 2, { lineSet: [2, 9, 6] });

  switcher.step(1);
  switcher.step(1);
  switcher.step(1);

  assert.deepEqual(active.picked, [9, 6, 2]);
});

test("multi-line stepping never leaves the set, even at its ends", () => {
  const { switcher, active } = switcherWithLines(12, 2, { lineSet: [2, 6] });

  switcher.step(-1);
  switcher.step(-1);

  assert.deepEqual(active.picked, [6, 2]);
});

test("an active line outside the set enters it from the stepped end", () => {
  const { switcher, active } = switcherWithLines(12, 11, { lineSet: [8, 3] });

  switcher.step(1);

  assert.deepEqual(active.picked, [8]);
});
