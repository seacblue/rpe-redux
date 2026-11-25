/** Session prompt launch milestones keep the recurring Star reminder predictable. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  nextLaunchCount,
  SESSION_PROMPT_LAUNCH_INTERVAL,
  shouldPromptForLaunch,
} from "../../../frontend/overlays/sessionPromptState.ts";

test("the Star prompt becomes due on every tenth launch", () => {
  assert.equal(SESSION_PROMPT_LAUNCH_INTERVAL, 10);
  assert.equal(shouldPromptForLaunch(10, false), true);
  assert.equal(shouldPromptForLaunch(20, false), true);
  assert.equal(shouldPromptForLaunch(9, false), false);
  assert.equal(shouldPromptForLaunch(11, false), false);
});

test("launch count increments malformed or missing persisted values from zero", () => {
  assert.equal(nextLaunchCount(undefined), 1);
  assert.equal(nextLaunchCount("9"), 1);
  assert.equal(nextLaunchCount(9), 10);
});

test("the permanent opt-out skips a due launch", () => {
  assert.equal(shouldPromptForLaunch(10, true), false);
});
