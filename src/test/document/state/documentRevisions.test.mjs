/** The shared revision contract carries editor state without widening Code Cell pins. */
import assert from "node:assert/strict";
import test from "node:test";
import { revisionConflicts, toDocumentRevisions } from "../../../core/contracts/revisions.ts";
import { createDocumentChangeCoordinator } from "../../../core/edit/document/changeCoordinator.ts";

test("coordination state reports the saved fingerprint through the shared type", () => {
  const coordinator = createDocumentChangeCoordinator({
    initial: {
      chartFingerprint: "live",
      savedChartFingerprint: "saved",
      diskSnapshot: "disk",
      generation: 3,
      lifecycle: "open",
      source: "synced",
    },
  });
  const revisions = coordinator.snapshot().revisions;
  assert.equal(revisions.chartFingerprint, "live");
  assert.equal(revisions.savedChartFingerprint, "saved");
  assert.equal(coordinator.snapshot().dirty, true);
});

test("revision pins compare only the three writable snapshot fields", () => {
  const current = {
    chartFingerprint: "live",
    savedChartFingerprint: "saved",
    diskSnapshot: "disk",
    generation: 3,
  };
  assert.deepEqual(revisionConflicts({ chartFingerprint: "live" }, current), []);
  assert.deepEqual(revisionConflicts({ chartFingerprint: "other", generation: 2 }, current), [
    "chartFingerprint",
    "generation",
  ]);
});

test("a rejected replacement keeps the original error for the caller", async () => {
  const coordinator = createDocumentChangeCoordinator({
    initial: { chartFingerprint: "live", lifecycle: "open" },
  });
  const failure = Object.assign(new Error("No RPE chart found in the PEZ archive."), {
    code: "pez_chart_missing",
  });
  const result = await coordinator.submitReplacement(async () => {
    throw failure;
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.error, failure);
  assert.equal(result.message, failure.message);
});

test("crossing into a Code Cell drops the saved-state fingerprint", () => {
  const coordinated = {
    chartFingerprint: "live",
    savedChartFingerprint: "saved",
    diskSnapshot: "disk",
    generation: 3,
  };
  assert.deepEqual(toDocumentRevisions(coordinated), {
    chartFingerprint: "live",
    diskSnapshot: "disk",
    generation: 3,
  });
});
