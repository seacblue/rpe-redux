/** The event layer lives on the session; timeline gestures and buttons only read or write it. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { requireSelectionApi } from "../../../core/edit/selection/api.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { createInspectorUiState } from "../../../frontend/screens/editor/inspector/surfaceState.ts";
import { createSessionPanels } from "../../../frontend/screens/editor/workspace/runtime/bridge/sessionPanels.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";
import {
  createLayerButtonsState,
  LayerButtons,
} from "../../../frontend/screens/editor/workspace/timeline/layers/layerButtons.ts";
import {
  EXTENDED_EVENT_LAYER,
  MAX_BASE_LAYERS,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/tracks.ts";
import { bindEditorSelection } from "../../../frontend/screens/editor/workspace/runtime/bindings/selectionBindings.ts";
import { values } from "../../../core/state/values.ts";
import { EDITING_FEATURE_KEYS } from "../../../core/settings/editingFeatureKeys.ts";
import "../../../core/settings/features/index.ts";
import { eventLayerShortcutEnabled } from "../../../core/edit/operations/keyboard.ts";

/** Minimal event-interaction handle; these tests never arm a placement. */
const interaction = { pending: null, drag: null };

test("the session layer is the only source for gesture layer and extended mode", () => {
  const session = new EditorSession(createChart());
  const gestures = new TimelineGestures(interaction, () => session);

  assert.equal(gestures.layer, 0);
  assert.equal(gestures.extended, false);

  session.eventLayer = 2;
  assert.equal(gestures.layer, 2);
  assert.equal(gestures.extended, false);

  session.eventLayer = EXTENDED_EVENT_LAYER;
  assert.equal(gestures.layer, EXTENDED_EVENT_LAYER);
  assert.equal(gestures.extended, true);

  gestures.layer = 1;
  assert.equal(session.eventLayer, 1);
  assert.equal(gestures.extended, false);
});

test("layer shortcuts respect the display switches", () => {
  const layerKey = EDITING_FEATURE_KEYS.eventLayers;
  const extendedKey = EDITING_FEATURE_KEYS.extendedEvents;
  const previousLayer = values.byId.get(layerKey);
  const previousExtended = values.byId.get(extendedKey);
  try {
    values.byId.set(layerKey, false);
    values.byId.set(extendedKey, false);
    assert.equal(eventLayerShortcutEnabled(0), true);
    assert.equal(eventLayerShortcutEnabled(1), false);
    assert.equal(eventLayerShortcutEnabled(MAX_BASE_LAYERS), false);
    values.byId.set(layerKey, true);
    assert.equal(eventLayerShortcutEnabled(1), true);
  } finally {
    values.byId.set(layerKey, previousLayer);
    values.byId.set(extendedKey, previousExtended);
  }
});

test("the layer buttons write the session once and a repaint never writes it back", () => {
  const session = new EditorSession(createChart());
  let storedLayer = session.eventLayer;
  let writes = 0;
  Object.defineProperty(session, "eventLayer", {
    configurable: true,
    get: () => storedLayer,
    set: (value) => {
      writes += 1;
      storedLayer = value;
    },
  });

  const gestures = new TimelineGestures(interaction, () => session);
  const timeline = {
    gestures,
    cache: { invalidateEvents() {} },
    cancelPlacement() {},
    eventTypes: ["moveXEvents"],
  };
  const state = createLayerButtonsState();
  const buttons = new LayerButtons(() => session, timeline, state);
  buttons.render();

  state.snapshot.get().onSelect(2);
  assert.equal(session.eventLayer, 2);
  assert.equal(writes, 1);
  assert.equal(gestures.extended, false);

  state.snapshot.get().onSelect(MAX_BASE_LAYERS);
  assert.equal(session.eventLayer, EXTENDED_EVENT_LAYER);
  assert.equal(writes, 2);
  assert.equal(gestures.extended, true);
  buttons.render();
  assert.equal(writes, 2);
  assert.equal(
    state.snapshot.get().items.find((item) => item.index === EXTENDED_EVENT_LAYER)?.active,
    true,
  );

  // A core-owned change must survive the next publication; the button strip
  // reads the session and has no value of its own to write back.
  session.eventLayer = 3;
  writes = 0;
  buttons.render();
  assert.equal(writes, 0);
  assert.equal(session.eventLayer, 3);
  assert.equal(gestures.layer, 3);

  // Selecting the layer that is already active is not a second core write.
  state.snapshot.get().onSelect(3);
  assert.equal(writes, 0);
  assert.equal(session.eventLayer, 3);
});

test("a session publication never overwrites the session-owned layer", () => {
  const session = new EditorSession(createChart());
  session.eventLayer = 3;
  session.liveEventEdit = true;
  const panels = createSessionPanels({
    ui: createInspectorUiState(),
    timeline: { eventPlacementType: undefined },
    layerButtons: { render() {} },
    multiEdit: { sync() {} },
    multiLinePanel: { render() {} },
    currentBeat: () => 0,
    reportError(error) {
      throw error;
    },
    notify() {},
    nudgeBeatInput: (value) => value,
  });

  panels.refresh(session, new TempoMap(session.chart.BPMList), "notes");
  assert.equal(session.eventLayer, 3);
});

test("a core extended selection derives the extended view through the one layer field", () => {
  const chart = createChart();
  chart.judgeLineList[0].extended = {
    textEvents: [createEvent("text", "text", 0, 1)],
  };
  chart.judgeLineList[0].eventLayers[1] = {
    moveXEvents: [createEvent(0, 1)],
  };
  const session = new EditorSession(chart);
  const gestures = new TimelineGestures(interaction, () => session);
  const timeline = {
    gestures,
    cache: { invalidateEvents() {} },
    cancelPlacement() {},
    eventTypes: ["moveXEvents"],
  };
  const dispose = bindEditorSelection(() => session, timeline, undefined);
  try {
    requireSelectionApi().events.select({
      lineIndex: 0,
      eventType: "textEvents",
      layer: "extended",
      indices: [0],
      mode: "replace",
    });
    assert.equal(session.eventLayer, EXTENDED_EVENT_LAYER);
    assert.equal(gestures.extended, true);

    requireSelectionApi().events.select({
      lineIndex: 0,
      eventType: "moveXEvents",
      layer: 1,
      indices: [0],
      mode: "replace",
    });
    assert.equal(session.eventLayer, 1);
    assert.equal(gestures.extended, false);
  } finally {
    dispose();
  }
});
