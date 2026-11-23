/**
 * Layer strip publication contract: a session repaint with unchanged layer
 * state must not notify subscribers, while selecting still targets the live
 * session.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";
import {
  createLayerButtonsState,
  LayerButtons,
} from "../../../frontend/screens/editor/workspace/timeline/layers/layerButtons.ts";
import { visibleLayerButtonItems } from "../../../frontend/screens/editor/workspace/timeline/layers/layerButtonVisibility.ts";

/** Minimal event-interaction handle; these tests never arm a placement. */
const interaction = { pending: null, drag: null };

/** Build the selector over one session variable shared with the gestures. */
function fixture() {
  let session = new EditorSession(createChart());
  const gestures = new TimelineGestures(interaction, () => session);
  const timeline = {
    gestures,
    cache: { invalidateEvents() {} },
    cancelPlacement() {},
    eventTypes: ["moveXEvents"],
  };
  const state = createLayerButtonsState();
  const buttons = new LayerButtons(() => session, timeline, state);
  return {
    state,
    buttons,
    get session() {
      return session;
    },
    replaceSession(next) {
      session = next;
    },
  };
}

test("an unchanged layer projection is not republished on every session paint", () => {
  const { state, buttons, session } = fixture();
  let publishes = 0;
  const unsubscribe = state.snapshot.subscribe(() => {
    publishes += 1;
  });

  buttons.render();
  assert.equal(publishes, 1);
  assert.deepEqual(
    state.snapshot.get().items.map((item) => item.index),
    [0, 1, 2, 3, 4],
  );

  buttons.render();
  buttons.render();
  assert.equal(publishes, 1, "a selection-only repaint notified the layer strip");

  session.eventLayer = 2;
  buttons.render();
  assert.equal(publishes, 2);
  assert.equal(state.snapshot.get().items.find((item) => item.active)?.index, 2);

  unsubscribe();
});

test("selecting through a retained snapshot writes the live session", () => {
  const { state, buttons, replaceSession } = fixture();
  buttons.render();
  const stale = state.snapshot.get().onSelect;

  const next = new EditorSession(createChart());
  replaceSession(next);
  // The projection is identical, so the old callback is still published.
  buttons.render();

  stale(3);
  assert.equal(next.eventLayer, 3);
  assert.equal(state.snapshot.get().items.find((item) => item.active)?.index, 0);

  buttons.render();
  assert.equal(state.snapshot.get().items.find((item) => item.active)?.index, 3);

  buttons.dispose();
  assert.equal(state.snapshot.get(), null);
});

test("display switches hide authored optional layers as well as empty layers", () => {
  const items = [
    { index: 0, label: "0", active: false },
    { index: 1, label: "1", active: true, optional: true },
    { index: 4, label: "Extended", active: false, extended: true },
  ];

  assert.deepEqual(
    visibleLayerButtonItems(items, { eventLayers: false, extendedEvents: false }).map(
      (item) => item.index,
    ),
    [0],
  );
  assert.deepEqual(
    visibleLayerButtonItems(items, { eventLayers: false, extendedEvents: true }).map(
      (item) => item.index,
    ),
    [0, 4],
  );
});
