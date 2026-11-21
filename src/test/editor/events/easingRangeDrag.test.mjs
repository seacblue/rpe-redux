/**
 * Verifies the easing range sliders keep a drag cheap.
 *
 * A drag used to commit one event transform per pointer move; each commit
 * rebuilds an event track and writes a history entry, which starved the preview
 * canvas. The sliders now hold a draft during the gesture and write once.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inspector = new URL(
  "../../../frontend/screens/editor/inspector/events/EventInspectorView.tsx",
  import.meta.url,
);

/** Read the range-field component's source. */
async function rangeFieldSource() {
  const source = await readFile(inspector, "utf8");
  const start = source.indexOf("function EasingRangeField");
  assert.ok(start >= 0, "EasingRangeField must exist in the event inspector");
  const end = source.indexOf("/** Renders the selected event's fields", start);
  assert.ok(end > start, "EasingRangeField must end before the inspector view");
  return source.slice(start, end);
}

test("a range drag publishes a draft instead of committing every step", async () => {
  const field = await rangeFieldSource();

  assert.match(field, /onChange=\{\(input\) => onDraft\(/, "a step must publish a draft");
  assert.match(field, /onCommit=\{onCommit\}/, "the gesture end must be the commit");
  assert.doesNotMatch(
    field,
    /onChange=\{[^}]*applyEventTransform/u,
    "a drag step must not run an event transform",
  );
});

test("the preview follows the draft while the stored event stays untouched", async () => {
  const source = await readFile(inspector, "utf8");

  assert.match(
    source,
    /easingLeft: liveRange\("easingLeft"\)/u,
    "the preview must read the live value for the left bound",
  );
  assert.match(
    source,
    /easingRight: liveRange\("easingRight"\)/u,
    "the preview must read the live value for the right bound",
  );
  assert.match(
    source,
    /easingLeft=\{previewCurveValues\.easingLeft\}/u,
    "the curve editor must receive the live left bound",
  );
  assert.match(
    source,
    /easingRight=\{previewCurveValues\.easingRight\}/u,
    "the curve editor must receive the live right bound",
  );
});

test("a committed value never flashes the stored one back", async () => {
  const source = await readFile(inspector, "utf8");

  assert.doesNotMatch(
    source,
    /setDraftRange\(field, null\);\s*const stored/u,
    "the commit path must not clear the draft before the event republishes",
  );
  assert.match(
    source,
    /const liveRange = \(field: "easingLeft" \| "easingRight"\) => \{[\s\S]*?return draft === null \|\| Math\.abs\(draft - stored\) < 1e-9 \? stored : draft;/u,
    "the live value must keep the draft until the stored event catches up",
  );
});
