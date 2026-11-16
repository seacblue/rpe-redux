/** Verifies retained packets submit only when a render surface changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { RenderGraph } from "../../../frontend/screens/editor/canvas/renderGraph.ts";

/** Minimal device adapter that records observable packet submissions. */
function fakeDevice() {
  const packets = [];
  return {
    packets,
    render(packet) {
      packets.push(packet);
    },
    dispose() {},
  };
}

const packet = (key) => ({
  surface: "timeline-selection-overlay",
  key,
  width: 320,
  height: 180,
  commands: [],
});

test("retained packet identity skips an unchanged surface", () => {
  const graph = new RenderGraph();
  const device = fakeDevice();

  assert.equal(graph.submit(packet("one"), device), true);
  assert.equal(graph.submit(packet("one"), device), false);
  assert.equal(device.packets.length, 1);
});

test("surface invalidation forces the next packet through", () => {
  const graph = new RenderGraph();
  const device = fakeDevice();

  graph.submit(packet("one"), device);
  graph.invalidate("timeline-selection-overlay");
  assert.equal(graph.submit(packet("one"), device), true);
  assert.equal(device.packets.length, 2);
});

test("different surfaces retain independently", () => {
  const graph = new RenderGraph();
  const device = fakeDevice();

  graph.submit({ ...packet("one"), surface: "timeline" }, device);
  graph.submit(packet("one"), device);
  assert.equal(device.packets.length, 2);
  assert.equal(graph.submit({ ...packet("one"), surface: "timeline" }, device), false);
  assert.equal(graph.submit(packet("one"), device), false);
});
