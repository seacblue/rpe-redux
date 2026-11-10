/**
 * Verifies screen-space curve picking, selection-gated deletion, grid snapping,
 * equation sampling, and the independent draw/equation path caches.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  componentFromNodes,
  reserveCurveIds,
  sampleComponentAt,
} from "../../../frontend/screens/editor/curveEvents/pathModel.ts";
import {
  curveHitTestStats,
  pickCurveTarget,
  resetCurveHitTestStats,
} from "../../../frontend/screens/editor/curveEvents/curveHitTest.ts";
import {
  curveEditPoint,
  curveGridSpacing,
} from "../../../frontend/screens/editor/curveEvents/drawOverlay.ts";
import {
  equationIsBlank,
  sampleEquationComponent,
} from "../../../frontend/screens/editor/curveEvents/equationDraft.ts";
import {
  easedPathProgress,
  easedSampleProgresses,
  generateCurveEvents,
} from "../../../frontend/screens/editor/curveEvents/generation.ts";
import { deleteCurveSelection } from "../../../frontend/screens/editor/curveEvents/selection.ts";
import {
  previewMarkerSampleStats,
  resetPreviewMarkerSampleStats,
  samplePreviewMarker,
} from "../../../frontend/screens/editor/curveEvents/previewSampling.ts";
import {
  bindCurveGestures,
  cancelCurveSession,
  curveActiveComponents,
  curveActiveTarget,
  hasCurveGesture,
} from "../../../frontend/screens/editor/curveEvents/store.ts";
import { curvePreviewLineTargets } from "../../../frontend/screens/editor/curveEvents/previewIsolation.ts";
import {
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";

const view = { width: 800, height: 600, scale: 2, centerX: 400, centerY: 300 };

function line(
  points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
) {
  const component = componentFromNodes("test", points, { smooth: false });
  assert.ok(component);
  return component;
}

test("picking uses the raw world point, not a grid-snapped one", () => {
  const component = line();
  const pick = pickCurveTarget({
    components: [component],
    selectedId: component.id,
    point: { x: 99.5, y: 0 },
    view,
  });
  assert.equal(pick.kind, "handle");
  assert.equal(pick.handle.field, "p3");
  assert.equal(pick.handleKind, "node");
});

test("the rotation handle wins before the frame and the path", () => {
  const component = line();
  const pick = pickCurveTarget({
    components: [component],
    selectedId: component.id,
    point: { x: 50, y: 13.5 },
    view,
  });
  assert.equal(pick.kind, "rotate");
});

test("the selection frame is a ring outside the visual bounds", () => {
  const component = line();
  assert.equal(
    pickCurveTarget({
      components: [component],
      selectedId: component.id,
      point: { x: 50, y: -2 },
      view,
    }).kind,
    "frame",
  );
  assert.equal(
    pickCurveTarget({
      components: [component],
      selectedId: component.id,
      point: { x: 50, y: -5 },
      view,
    }).kind,
    "path",
  );
  assert.equal(
    pickCurveTarget({
      components: [component],
      selectedId: component.id,
      point: { x: 50, y: -20 },
      view,
    }).kind,
    "empty",
  );
});

test("segment bounds skip sampling for paths far from the pointer", () => {
  const component = line(
    Array.from({ length: 50 }, (unused, index) => ({ x: index * 100, y: index % 2 ? 20 : 0 })),
  );
  resetCurveHitTestStats();
  const pick = pickCurveTarget({
    components: [component],
    selectedId: null,
    point: { x: 0, y: 0 },
    view,
  });
  const stats = curveHitTestStats();

  assert.equal(pick.kind, "path");
  assert.equal(pick.segmentIndex, 0);
  assert.ok(stats.segmentsSkipped >= component.segments.length - 3, "far segments are culled");
  assert.ok(stats.segmentsTested <= 3, "only segments near the pointer run the sampler");
});

test("nodes take priority over overlapping control points", () => {
  const component = line();
  const node = pickCurveTarget({
    components: [component],
    selectedId: component.id,
    point: { x: 0, y: 0 },
    view,
  });
  assert.equal(node.kind, "handle");
  assert.equal(node.handle.field, "p0");
  assert.equal(node.handleKind, "node");

  const control = pickCurveTarget({
    components: [component],
    selectedId: component.id,
    point: { x: 33, y: 0 },
    view,
  });
  assert.equal(control.kind, "handle");
  assert.equal(control.handleKind, "control");
});

test("Delete removes a selected segment before the whole path", () => {
  const component = line([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ]);
  const afterSegment = deleteCurveSelection([component], component.id, {
    componentId: component.id,
    segmentIndex: 0,
  });
  assert.equal(afterSegment.removed, "segment");
  assert.equal(afterSegment.selectedId, component.id);
  assert.equal(afterSegment.selectedSegment, null);
  assert.equal(afterSegment.components[0].segments.length, 1);

  const afterPath = deleteCurveSelection([component], component.id, null);
  assert.equal(afterPath.removed, "path");
  assert.equal(afterPath.selectedId, null);
  assert.deepEqual(afterPath.components, []);
});

test("Delete with no selection is a no-op", () => {
  const component = line();
  const result = deleteCurveSelection([component], null, null);
  assert.equal(result.removed, null);
  assert.equal(result.components.length, 1);
  assert.equal(result.selectedId, null);
});

test("grid distance stays inside the authoring range", () => {
  assert.equal(curveGridSpacing(5), 10);
  assert.equal(curveGridSpacing(50), 50);
  assert.equal(curveGridSpacing(500), 200);
});

test("a visible grid always snaps authoring points", () => {
  assert.deepEqual(curveEditPoint({ x: 12, y: 9 }, false, 50), { x: 12, y: 9 });
  assert.deepEqual(curveEditPoint({ x: 12, y: 9 }, true, 50), { x: 0, y: 0 });
  assert.deepEqual(curveEditPoint({ x: 72, y: 91 }, true, 50), { x: 50, y: 100 });
});

test("equation sampling keeps valid paths and ignores invalid expressions", () => {
  const equation = {
    xExpression: "-420+840*t",
    yExpression: "220*sin(2*pi*t)",
    parameterStart: "0",
    parameterEnd: "1",
  };
  assert.equal(equationIsBlank(equation), false);
  assert.equal(equationIsBlank({ ...equation, xExpression: "", yExpression: "" }), true);
  const component = sampleEquationComponent(equation, "Equation");
  assert.ok(component);
  assert.ok(component.segments.length > 0);
  assert.equal(
    sampleEquationComponent({ ...equation, xExpression: "not a function" }, "Equation"),
    null,
  );
});

test("t easing moves cut samples along the path without moving the endpoints", () => {
  assert.deepEqual(easedSampleProgresses(4, 1), [0, 0.25, 0.5, 0.75, 1]);
  const eased = easedSampleProgresses(4, 5);
  assert.equal(eased[0], 0);
  assert.equal(eased.at(-1), 1);
  assert.ok(eased[1] < 0.25);
  assert.ok(eased[2] < 0.5);
  assert.ok(eased[3] < 0.75);
});

test("t easing changes the generating event values, not the beat grid", () => {
  const component = line();
  const generate = (tEasing) => {
    const session = {
      readOnly: false,
      editable: true,
      chart: {
        META: { offset: 0 },
        BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
        judgeLineList: [{ notes: [], eventLayers: [{}] }],
      },
      lineIndex: 0,
      eventLayer: 0,
      focus: "notes",
      selection: new Set(),
      eventSelection: new Set(),
      selectionState() {
        return {
          lineIndex: 0,
          eventLayer: this.eventLayer,
          focus: this.focus,
          selection: [...this.selection],
          eventSelection: [...this.eventSelection],
          multiLineSelection: [],
          multiEventSelection: [],
          multiLineEnabled: false,
          multiLineMode: "notes",
          multiLineMerge: true,
          multiLineIndices: [],
        };
      },
      commitChart(unused, next) {
        this.chart = next;
        return true;
      },
    };
    return generateCurveEvents(session, {
      component,
      startBeat: 0,
      endBeat: 4,
      layer: 0,
      cutStepBeats: 0.25,
      tEasing,
      fit: false,
      fitTolerance: 1,
      replace: true,
    }).chart.judgeLineList[0].eventLayers[0].moveXEvents;
  };
  const linear = generate(1);
  const eased = generate(5);
  assert.equal(linear.length, 16);
  assert.equal(eased.length, 16);
  assert.deepEqual(
    linear.map((event) => event.startTime),
    eased.map((event) => event.startTime),
  );
  assert.ok(eased[0].end < linear[0].end);
});

test("the preview marker uses the generation's easing map", () => {
  for (const tEasing of [1, 5, 9, 11, 26, 29]) {
    const samples = easedSampleProgresses(8, tEasing);
    for (let index = 0; index <= 8; index += 1) {
      assert.equal(
        easedPathProgress(index / 8, tEasing),
        samples[index],
        `tEasing ${tEasing} sample ${index} matches generation`,
      );
    }
  }
  assert.equal(easedPathProgress(-1, 5), 0);
  assert.equal(easedPathProgress(2, 5), 1);
});

test("cached preview sampling matches generation positions and reuses its arc table", () => {
  const component = line([
    { x: -200, y: 0 },
    { x: 0, y: 80 },
    { x: 200, y: -40 },
  ]);
  resetPreviewMarkerSampleStats();
  const expected = sampleComponentAt(component, easedSampleProgresses(8, 5));
  for (let index = 0; index <= 8; index += 1) {
    const point = samplePreviewMarker(component, 5, index / 8);
    assert.ok(point);
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-9);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-9);
  }
  const afterSweep = previewMarkerSampleStats();
  assert.equal(afterSweep.tableMisses, 1, "the component builds its arc table once");
  assert.equal(afterSweep.tableHits, 8, "later samples reuse the arc table");
  assert.equal(afterSweep.samples, 9);

  assert.deepEqual(samplePreviewMarker(component, 5, 1), expected.at(-1));
  const repeated = previewMarkerSampleStats();
  assert.equal(repeated.pointHits, 1, "an unchanged progress reuses the last point");
  assert.equal(repeated.samples, 9);

  const other = line([
    { x: -200, y: 50 },
    { x: 200, y: -50 },
  ]);
  samplePreviewMarker(other, 5, 0.5);
  assert.equal(
    previewMarkerSampleStats().tableMisses,
    2,
    "a changed draft path builds a new arc table",
  );
});

test("ending a curve session cancels a pending gesture", () => {
  let cancelled = 0;
  const unbind = bindCurveGestures({
    hasPending: () => true,
    cancel: () => {
      cancelled += 1;
    },
    deleteSelected: () => {},
  });
  try {
    assert.equal(hasCurveGesture(), true);
    assert.equal(cancelCurveSession(), true);
    assert.equal(cancelled, 1);
  } finally {
    unbind();
  }
  assert.equal(hasCurveGesture(), false, "unbinding clears the bridge");
  assert.equal(cancelCurveSession(), false);
  assert.equal(cancelled, 1, "an idle session does not call cancel");
});

test("ending a curve session with no gesture is a no-op", () => {
  let cancelled = 0;
  const unbind = bindCurveGestures({
    hasPending: () => false,
    cancel: () => {
      cancelled += 1;
    },
    deleteSelected: () => {},
  });
  try {
    assert.equal(hasCurveGesture(), false);
    assert.equal(cancelCurveSession(), false);
    assert.equal(cancelled, 0);
  } finally {
    unbind();
  }
});

test("the preview focus follows the current line and the solo toggle", () => {
  assert.deepEqual(
    curvePreviewLineTargets({ active: true, previewLineOnly: false, lineIndex: 3 }),
    { soloLine: null, focusLine: 3 },
  );
  assert.deepEqual(curvePreviewLineTargets({ active: true, previewLineOnly: true, lineIndex: 4 }), {
    soloLine: 4,
    focusLine: 4,
  });
  assert.deepEqual(
    curvePreviewLineTargets({ active: false, previewLineOnly: true, lineIndex: 4 }),
    { soloLine: null, focusLine: null },
  );
});

test("the active mode exposes only its own cached path", () => {
  const draw = line();
  const equation = line([
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ]);
  const state = {
    components: [draw],
    selectedId: draw.id,
    equation: { component: equation },
  };
  assert.deepEqual(curveActiveComponents({ ...state, editMode: "draw" }), [draw]);
  assert.deepEqual(curveActiveComponents({ ...state, editMode: "equation" }), [equation]);
  assert.equal(curveActiveTarget({ ...state, editMode: "draw" }), draw);
  assert.equal(curveActiveTarget({ ...state, editMode: "equation" }), equation);
});

test("restored component ids do not collide with new paths", () => {
  const restored = { ...line(), id: "curve-9999" };
  reserveCurveIds([restored]);
  const next = line();
  assert.notEqual(next.id, restored.id);
  assert.match(next.id, /^curve-\d+$/);
});

test("curve delete is a registered D shortcut in its own category", () => {
  const dispose = registerEditorShortcuts();
  try {
    const shortcut = shortcutRegistry
      .shortcuts()
      .find((entry) => entry.id === "editor.curve.delete");
    assert.ok(shortcut);
    assert.equal(shortcut.category, "editor.curve");
    assert.equal(shortcut.defaults[0].key, "D");
  } finally {
    dispose();
  }
});

test("D means curve delete while the curve stage is open", () => {
  const dispose = registerEditorShortcuts();
  try {
    const shortcutContext = {
      atHome: false,
      documentOpen: true,
      modal: "none",
      capturing: false,
      developerMode: false,
      textEntry: false,
      surface: null,
    };
    assert.equal(
      matchEditorShortcut(
        { key: "D" },
        { area: "preview", hasSelection: true, curveMode: true },
        shortcutContext,
      ),
      "editor.curve.delete",
    );
    assert.equal(
      matchEditorShortcut(
        { key: "D" },
        { area: "preview", hasSelection: true, curveMode: false },
        shortcutContext,
      ),
      "edit.delete",
    );
  } finally {
    dispose();
  }
});
