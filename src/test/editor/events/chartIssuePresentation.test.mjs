/** Regression contracts for chart-issue locate layout and global density copy. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  issueJumpTimelineMode,
  issueTitleLine,
} from "../../../frontend/screens/editor/inspector/eventIssues/issuePresentation.ts";

test("locating an issue preserves a note and event timeline shown together", () => {
  assert.equal(issueJumpTimelineMode("notes", { showNotes: true, showEvents: true }), null);
});

test("locating an issue still reveals its target when only one timeline is shown", () => {
  assert.equal(issueJumpTimelineMode("events", { showNotes: true, showEvents: false }), "events");
});

test("density issue titles do not name a judge line", () => {
  assert.equal(issueTitleLine({ kind: "density" }, "#2 Dense"), null);
  assert.equal(issueTitleLine({ kind: "overlap" }, "#2 Dense"), "#2 Dense");
});
