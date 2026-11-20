/**
 * Multi-line headers never condense their text: default names collapse to the
 * number, overlong names are truncated with an explicit ellipsis, and a header
 * with no room for even one name character falls back to the number.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { multiLineLineLabel } from "../../../frontend/screens/editor/workspace/timeline/multiLine/multiLineLineLabel.ts";
import { t } from "../../../i18n/index.ts";

const measure = (text) => text.length * 10;
const namedLabel = (index, name) => t("editorPanels.timeline.lineHeader", { index, name });
const indexLabel = (index) => t("editorPanels.timeline.lineHeaderIndex", { index });

test("default line names collapse to the line number", () => {
  assert.equal(multiLineLineLabel(3, { Name: "Untitled" }), indexLabel(3));
  assert.equal(multiLineLineLabel(3, { Name: "" }), indexLabel(3));
  assert.equal(multiLineLineLabel(3, {}), indexLabel(3));
  assert.equal(
    multiLineLineLabel(3, { Name: "Line 4" }),
    indexLabel(3),
    "a generated name is a default name",
  );
});

test("a custom name stays while the whole header fits", () => {
  const label = namedLabel(3, "Lead");

  assert.equal(multiLineLineLabel(3, { Name: "Lead" }, measure(label), measure), label);
});

test("an overlong English title is truncated with an explicit ellipsis", () => {
  const name = "This is an extremely long judge line title used to verify truncation";
  const label = multiLineLineLabel(3, { Name: name }, 140, measure);

  assert.equal(label, namedLabel(3, "This is..."));
  assert.ok(label.endsWith("..."), "the truncated header ends with a literal ellipsis");
  assert.ok(measure(label) <= 140, "the truncated header fits its width budget");
});

test("an overlong Chinese title is truncated by character", () => {
  const name = "这是一条非常长的判定线标题用于验证截断效果";
  const label = multiLineLineLabel(3, { Name: name }, 130, measure);

  assert.equal(label, namedLabel(3, "这是一条非常..."));
  assert.ok(label.endsWith("..."));
  assert.ok(measure(label) <= 130);
});

test("a header with no room for one name character falls back to the number", () => {
  assert.equal(multiLineLineLabel(3, { Name: "A long title" }, 70, measure), indexLabel(3));
});

test("a number that does not fit leaves the header empty", () => {
  assert.equal(multiLineLineLabel(3, { Name: "Lead" }, measure(indexLabel(3)) - 1, measure), "");
  assert.equal(multiLineLineLabel(3, { Name: "Lead" }, 0, measure), "");
});

test("without a width budget the header keeps the full custom name", () => {
  assert.equal(multiLineLineLabel(3, { Name: "Lead" }), namedLabel(3, "Lead"));
});
