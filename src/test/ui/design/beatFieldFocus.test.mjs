/** The composed BeatField delays blur commits across its own part inputs. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  commitBeatFieldScope,
  flushBeatFieldScope,
  registerBeatFieldScopeCommit,
  remainsWithinBeatField,
} from "../../../design/components/input/beatFieldFocus.ts";

const boundary = (inside) => ({
  contains(candidate) {
    return inside.has(candidate);
  },
});

test("missing relatedTarget still keeps a transition inside the same field", () => {
  const previous = {};
  const next = {};
  const field = boundary(new Set([next]));

  assert.equal(remainsWithinBeatField(field, null, previous, next), true);
});

test("an explicit target outside the field commits", () => {
  const previous = {};
  const outside = {};
  const field = boundary(new Set());

  assert.equal(remainsWithinBeatField(field, outside, previous, outside), false);
});

test("a click outside that leaves the old input active commits", () => {
  const previous = {};
  const field = boundary(new Set([previous]));

  assert.equal(remainsWithinBeatField(field, null, previous, previous), false);
});

test("a missing boundary never suppresses a commit", () => {
  assert.equal(remainsWithinBeatField(null, null, {}, {}), false);
});

test("only commits deferred fields in the closed inspector scope", () => {
  const committed = [];
  const disposeNotes = registerBeatFieldScopeCommit("notes", () => committed.push("notes"));
  const disposeEvents = registerBeatFieldScopeCommit("events", () => committed.push("events"));

  commitBeatFieldScope("notes");
  assert.deepEqual(committed, ["notes"]);

  disposeNotes();
  commitBeatFieldScope("notes");
  commitBeatFieldScope("events");
  assert.deepEqual(committed, ["notes", "events"]);

  disposeEvents();
});

test("releases the draft guard before flushing the closed scope", () => {
  let draftActive = true;
  let observedDraftActive;
  const dispose = registerBeatFieldScopeCommit("notes-order", () => {
    observedDraftActive = draftActive;
  });

  flushBeatFieldScope("notes-order", () => {
    draftActive = false;
  });

  assert.equal(observedDraftActive, false);
  dispose();
});
