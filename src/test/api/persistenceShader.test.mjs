/** Persistence rules and workspace shader passes share the same disk boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  persistenceRules,
  prepareChartForPersistence,
} from "../../core/global/chart/persistence.ts";
import { workspaceShaderPasses } from "../../core/global/chart/shader/workspacePasses.ts";
import { createChartTextExport } from "../../core/global/document/export.ts";

const noteRuleId = "test.persistence.note-fields";
const eventRuleId = "test.persistence.event-fields";
const lineRuleId = "test.persistence.line-fields";
const shaderBeforeId = "test.shader.before";
const shaderAfterId = "test.shader.after";
const shaderMaskId = "test.shader.mask";
const shaderPortableId = "test.shader.portable";

function fixture() {
  return {
    META: {},
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      {
        Name: "line",
        notes: [
          { id: "note-a", type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1] },
          { id: "note-b", type: 2, startTime: [1, 0, 1], endTime: [1, 0, 1] },
        ],
        eventLayers: [
          {
            moveXEvents: [
              {
                id: "event-a",
                startTime: [0, 0, 1],
                endTime: [1, 0, 1],
                start: 0,
                end: 10,
              },
            ],
          },
        ],
      },
    ],
  };
}

test("persistence rules project notes, events, and judge lines without mutating the live chart", () => {
  const chart = fixture();
  persistenceRules.register({
    id: noteRuleId,
    label: "Test note fields",
    kind: "note",
    match: { type: 1 },
    set: { reduxAccent: "gold" },
    warning: { code: "test.note.external", message: "note metadata" },
  });
  persistenceRules.register({
    id: eventRuleId,
    label: "Test event fields",
    kind: "event",
    match: { id: "event-a" },
    set: { reduxPhase: 2 },
    remove: ["end"],
  });
  persistenceRules.register({
    id: lineRuleId,
    label: "Test line fields",
    kind: "judgeLine",
    set: { reduxLayer: "foreground" },
  });

  try {
    const result = prepareChartForPersistence(chart, "export");
    assert.equal(chart.judgeLineList[0].reduxLayer, undefined);
    assert.equal(chart.judgeLineList[0].notes[0].reduxAccent, undefined);
    assert.equal(chart.judgeLineList[0].eventLayers[0].moveXEvents[0].end, 10);
    assert.equal(result.chart.judgeLineList[0].reduxLayer, "foreground");
    assert.equal(result.chart.judgeLineList[0].notes[0].reduxAccent, "gold");
    assert.equal(result.chart.judgeLineList[0].notes[1].reduxAccent, undefined);
    assert.equal(result.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].reduxPhase, 2);
    assert.equal(result.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].end, undefined);
    assert.deepEqual(result.warnings, [
      {
        code: "test.note.external",
        message: "note metadata",
        ruleId: noteRuleId,
      },
    ]);
    const exported = createChartTextExport(chart, "test", "official");
    assert.equal(exported.warningDetails[0].code, "test.note.external");

    persistenceRules.setEnabled(noteRuleId, false);
    const disabled = prepareChartForPersistence(chart, "export");
    assert.equal(disabled.chart.judgeLineList[0].notes[0].reduxAccent, undefined);
  } finally {
    persistenceRules.unregister(noteRuleId);
    persistenceRules.unregister(eventRuleId);
    persistenceRules.unregister(lineRuleId);
  }
});

test("workspace shader passes have deterministic stages and export metadata", () => {
  workspaceShaderPasses.register({
    id: shaderAfterId,
    label: "After pass",
    source: "after",
    position: "after-chart",
    order: 20,
    exportPolicy: "embed",
  });
  workspaceShaderPasses.register({
    id: shaderBeforeId,
    label: "Before pass",
    source: "before",
    position: "before-chart",
    order: 10,
    exportPolicy: "warn",
  });

  try {
    assert.deepEqual(
      workspaceShaderPasses.active().map((pass) => pass.workspacePassId),
      [shaderBeforeId, shaderAfterId],
    );
    workspaceShaderPasses.setEnabled(shaderBeforeId, false);
    assert.deepEqual(
      workspaceShaderPasses.active().map((pass) => pass.workspacePassId),
      [shaderAfterId],
    );

    const result = prepareChartForPersistence(fixture(), "export");
    assert.equal(result.chart.META.ReduxWorkspaceShaderPasses.length, 1);
    assert.equal(result.chart.META.ReduxWorkspaceShaderPasses[0].id, shaderAfterId);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].ruleId, `shader:${shaderAfterId}`);
  } finally {
    workspaceShaderPasses.unregister(shaderBeforeId);
    workspaceShaderPasses.unregister(shaderAfterId);
  }
});

test("workspace shader masks resolve semantic note layers into one atlas selector", () => {
  workspaceShaderPasses.register({
    id: shaderMaskId,
    label: "Note mask",
    source: "mask",
    mask: { layers: ["chart.note.tap", "chart.note.flick"] },
    exportPolicy: "embed",
  });

  try {
    const [pass] = workspaceShaderPasses.active();
    assert.deepEqual(pass.mask?.selection, [0, 0, 1, 1]);
    assert.equal(pass.mask?.key, "chart.note.flick,chart.note.tap");
    const result = prepareChartForPersistence(fixture(), "export");
    assert.deepEqual(result.chart.META.ReduxWorkspaceShaderPasses[0].mask, {
      layers: ["chart.note.tap", "chart.note.flick"],
    });
  } finally {
    workspaceShaderPasses.unregister(shaderMaskId);
  }
});

test("standalone shader export lowers a masked pass to its portable source", () => {
  workspaceShaderPasses.register({
    id: shaderPortableId,
    label: "Portable pass",
    source: "layered",
    portable: { source: "standalone" },
    mask: { layers: ["chart.note.tap"] },
    exportPolicy: "embed",
  });

  try {
    workspaceShaderPasses.setExportMode("standalone");
    const result = prepareChartForPersistence(fixture(), "export");
    assert.equal(result.chart.META.ReduxWorkspaceShaderPasses[0].source, "standalone");
    assert.equal(result.chart.META.ReduxWorkspaceShaderPasses[0].mask, undefined);
    assert.match(result.warnings[0].code, /portable-approximation/);
  } finally {
    workspaceShaderPasses.setExportMode("layered");
    workspaceShaderPasses.unregister(shaderPortableId);
  }
});

test("workspace shader note-field masks select semantic note metadata", () => {
  const id = "test.shader.hand-mask";
  workspaceShaderPasses.register({
    id,
    label: "Hand mask",
    source: "field-mask",
    mask: { kind: "note-field", field: "hand", value: "left", channel: 0 },
    exportPolicy: "embed",
  });
  try {
    const [pass] = workspaceShaderPasses.active();
    assert.equal(pass.mask?.atlas, "note-fields");
    assert.equal(pass.mask?.key, "note:hand=left");
    assert.deepEqual(pass.mask?.selection, [1, 0, 0, 0]);
    assert.deepEqual(
      prepareChartForPersistence(fixture(), "save").chart.META.ReduxWorkspaceShaderPasses[0].mask,
      {
        kind: "note-field",
        field: "hand",
        value: "left",
        channel: 0,
      },
    );
  } finally {
    workspaceShaderPasses.unregister(id);
  }
});
