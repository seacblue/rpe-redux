/** Tutorial steps open the surface they teach and target real controls. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildOnboardingSteps } from "../../../frontend/onboarding/steps.ts";
import { INSPECTOR_TUTORIALS } from "../../../frontend/screens/editor/inspector/tutorials.ts";
import { GLOBAL_PAGE_TUTORIALS } from "../../../frontend/screens/global/tutorials.ts";

const translate = (key) => key;

test("first-run metadata and parameter steps open their inspector", () => {
  const steps = buildOnboardingSteps({ choice: "new", hasDocument: true }, translate, translate);
  const metadata = steps.find((step) => step.id === "metadata");
  assert.deepEqual(metadata?.targets, ["metadata-field-name"]);
  assert.deepEqual(metadata?.activate, { kind: "inspector", id: "metadata" });
  const parameters = steps.find((step) => step.id === "parameters");
  assert.deepEqual(parameters?.targets, ["notes"]);
  assert.deepEqual(parameters?.activate, { kind: "inspector", id: "notes" });
});

test("inspector tutorials declare their surface and target field anchors", () => {
  for (const [id, tutorial] of Object.entries(INSPECTOR_TUTORIALS)) {
    assert.equal(tutorial.activate?.kind, "inspector", `${id} must open an inspector`);
    assert.ok(tutorial.activate?.id, `${id} must name its inspector panel`);
  }
  assert.deepEqual(INSPECTOR_TUTORIALS.metadata.steps[0].targets, ["metadata-field-name"]);
  assert.deepEqual(INSPECTOR_TUTORIALS.metadata.steps[1].targets, ["metadata-field-composer"]);
  assert.deepEqual(INSPECTOR_TUTORIALS.metadata.steps[2].targets, ["metadata-resources"]);
  assert.ok(INSPECTOR_TUTORIALS.notes.steps[1].targets?.includes("notes-properties"));
  assert.ok(INSPECTOR_TUTORIALS.events.steps[0].targets?.includes("events"));
});

test("large document pages declare the inspector page they teach", () => {
  for (const [id, tutorial] of Object.entries(GLOBAL_PAGE_TUTORIALS)) {
    assert.equal(tutorial.activate?.kind, "inspector", `${id} must open an inspector page`);
    assert.ok(tutorial.activate?.id, `${id} must name its inspector panel`);
    assert.deepEqual(
      tutorial.steps[0].targets,
      [`inspector-panel-${tutorial.activate?.id}`],
      `${id} must anchor to its mounted panel`,
    );
  }
});
