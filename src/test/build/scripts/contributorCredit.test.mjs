/**
 * Verifies the contributor-credit notice: which pull requests it skips, and the
 * three bodies it can publish without ever touching the contributor's file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { creditComment, creditPlan } from "../../../../scripts/contributorCredit.mjs";

const CHANGESET = { contributors: undefined };

test("skips maintainers, bots, and invalid authors", () => {
  assert.equal(creditPlan({ author: "seacblue", changesets: [] }).kind, "skip");
  assert.equal(
    creditPlan({ author: "dependabot", authorType: "Bot", changesets: [] }).kind,
    "skip",
  );
  assert.equal(creditPlan({ author: "renovate", changesets: [] }).kind, "skip");
  assert.equal(creditPlan({ author: "not a login", changesets: [] }).kind, "skip");
});

test("asks for a Changeset when the pull request adds none", () => {
  const plan = creditPlan({ author: "alice", changesets: [], hasChangesetFile: false });
  assert.equal(plan.kind, "missing");
  const body = creditComment({ plan });
  assert.match(body, /contributor-credit/u);
  assert.match(body, /\.changeset\/<name>\.md/u);
  assert.match(body, /- @alice/u);
});

test("reports the logins a Changeset already records", () => {
  const plan = creditPlan({
    author: "alice",
    changesets: [CHANGESET, { contributors: ["bob", "carol"] }, { contributors: ["bob"] }],
  });
  assert.equal(plan.kind, "recorded");
  assert.deepEqual(plan.logins, ["bob", "carol"]);
  const body = creditComment({ plan });
  assert.match(body, /@bob, @carol/u);
  assert.match(body, /never edits the Changeset file/u);
});

test("reports an empty contributor block as an opt-out", () => {
  const plan = creditPlan({ author: "alice", changesets: [{ contributors: [] }] });
  assert.equal(plan.kind, "recorded");
  assert.deepEqual(plan.logins, []);
  assert.match(creditComment({ plan }), /opts this change out/u);
});

test("suggests the automatic credit for an unnamed Changeset", () => {
  const plan = creditPlan({ author: "alice", changesets: [CHANGESET] });
  assert.equal(plan.kind, "suggested");
  const body = creditComment({ plan });
  assert.match(body, /credits \*\*@alice\*\*/u);
  assert.match(body, /### Contributors/u);
  assert.match(body, /never edits the Changeset file/u);
});
