/** Verifies detached recipe planning, one-shot apply, cancel, and stale plans. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRecipeHandle, recipe } from "../../../core/api/recipe.ts";
import { connectSelectionApi } from "../../../core/edit/selection/api.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";
import { createChart } from "../../../core/global/chart/chart.ts";

const renameStep = {
  op: "transaction",
  request: { label: "rename", metadata: { name: "Changed" } },
};

test("planning a recipe does not write the chart or history", () => {
  const session = new EditorSession(createChart());
  const beforeName = session.chart.META.name;
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const planned = recipe.plan({
      steps: [renameStep],
      label: "Rename chart",
    });
    assert.equal(planned.ok, true);
    assert.equal(planned.value.status, "planned");
    assert.equal(typeof planned.value.planId, "string");
    assert.ok(planned.value.counts.lines > 0);
    assert.equal(session.chart.META.name, beforeName);
    assert.equal(session.history.undoStack.length, 0);

    const applied = recipe.apply(planned.value.planId);
    assert.equal(applied.ok, true);
    assert.equal(applied.value.status, "committed");
    assert.equal(session.chart.META.name, "Changed");
    assert.equal(session.history.undoStack.length, 1);
    assert.equal(session.history.undoStack[0].recipe?.name, "Rename chart");

    const again = recipe.apply(planned.value.planId);
    assert.equal(again.ok, false);
    assert.equal(again.error.code, "invalid_request");
  } finally {
    disconnect();
  }
});

test("a parameterized recipe can create and populate a line folder", () => {
  const session = new EditorSession(createChart());
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const planned = recipe.plan({
      steps: [
        {
          op: "transaction",
          request: {
            lineGroups: {
              create: [{ name: { expression: "folder" } }],
              assign: [{ group: { expression: "folder" }, lineIndices: { expression: "lines" } }],
            },
          },
        },
      ],
      params: { folder: "Lead", lines: [0] },
      label: "Create Lead folder",
    });
    assert.equal(planned.ok, true);
    assert.equal(planned.value.status, "planned");
    assert.deepEqual(session.chart.judgeLineGroup, ["Default"]);

    const applied = recipe.apply(planned.value.planId);
    assert.equal(applied.ok, true);
    assert.equal(applied.value.status, "committed");
    assert.deepEqual(session.chart.judgeLineGroup, ["Default", "Lead"]);
    assert.equal(session.chart.judgeLineList[0].Group, 1);
  } finally {
    disconnect();
  }
});

test("cancelling a plan makes it unavailable", () => {
  const session = new EditorSession(createChart());
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const planned = recipe.plan({ steps: [renameStep] });
    assert.equal(planned.ok, true);
    assert.equal(recipe.cancel(planned.value.planId).value, true);
    const applied = recipe.apply(planned.value.planId);
    assert.equal(applied.ok, false);
    assert.equal(applied.error.code, "invalid_request");
  } finally {
    disconnect();
  }
});

test("a chart edit drops an existing plan", () => {
  const session = new EditorSession(createChart());
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const planned = recipe.plan({ steps: [renameStep] });
    assert.equal(planned.ok, true);
    const changed = applyChartTransaction(session, {
      label: "unrelated",
      metadata: { composer: "Other" },
    });
    assert.equal(changed.status, "committed");
    const applied = recipe.apply(planned.value.planId);
    assert.equal(applied.ok, false);
    assert.ok(
      applied.error.code === "invalid_request" || applied.error.code === "rejected",
      `unexpected code: ${applied.error.code}`,
    );
  } finally {
    disconnect();
  }
});

test("plans belong to the handle owner", () => {
  const session = new EditorSession(createChart());
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const first = createRecipeHandle("owner.a");
    const second = createRecipeHandle("owner.b");
    const planned = first.plan({ steps: [renameStep] });
    assert.equal(planned.ok, true);
    const foreign = second.apply(planned.value.planId);
    assert.equal(foreign.ok, false);
    const own = first.apply(planned.value.planId);
    assert.equal(own.ok, true);
  } finally {
    disconnect();
  }
});

test("a plan rejects a request for a different chart fingerprint", () => {
  const session = new EditorSession(createChart());
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const planned = recipe.plan({
      steps: [renameStep],
      chartFingerprint: "not-the-current-fingerprint",
    });
    assert.equal(planned.ok, false);
    assert.equal(planned.error.code, "stale_read");
    assert.equal(session.history.undoStack.length, 0);
  } finally {
    disconnect();
  }
});
