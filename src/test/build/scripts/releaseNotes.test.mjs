/**
 * Verifies the Changeset side of the release notes: the optional
 * language-neutral `### Contributors` block, and the inline plus release-wide
 * credit the changelog renders from it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReleaseNotes,
  parseChangesetSource,
  renderLanguageSection,
} from "../../../../scripts/releaseNotes.mjs";

const CHANGESET = `---
"rpe-redux": patch
---

### 中文

**修复**

- 第一条。
- 第二条。

### English

**Fixes**

- First.
- Second.
`;

/** Parse one fixture and return its release-note maps for both languages. */
function notesFor(changesets) {
  const parsed = changesets.map((changeset) =>
    parseChangesetSource(changeset.source ?? CHANGESET, changeset.label ?? "changeset.md"),
  );
  return collectReleaseNotes(
    parsed.map((changeset, index) => ({
      ...changeset,
      contributors:
        "contributors" in changesets[index]
          ? changesets[index].contributors
          : changeset.contributors,
    })),
  );
}

test("reads a changeset without a contributor block", () => {
  const parsed = parseChangesetSource(CHANGESET, "plain.md");
  assert.equal(parsed.bump, "patch");
  assert.equal(parsed.contributors, undefined);
  assert.match(parsed.chinese, /第一条/u);
  assert.match(parsed.english, /First/u);
});

test("reads a contributor block before the language sections", () => {
  const source = CHANGESET.replace("### 中文", "### Contributors\n\n- @alice\n\n### 中文");
  const parsed = parseChangesetSource(source, "early.md");
  assert.deepEqual(parsed.contributors, ["alice"]);
  assert.match(parsed.chinese, /第一条/u);
  assert.match(parsed.english, /First/u);
});

test("normalizes and deduplicates contributor logins", () => {
  const source = `${CHANGESET}\n### Contributors\n\n- @Alice\n- alice\n- @bob-smith\n`;
  assert.deepEqual(parseChangesetSource(source, "list.md").contributors, ["Alice", "bob-smith"]);
});

test("keeps an empty contributor block as a deliberate opt-out", () => {
  assert.deepEqual(
    parseChangesetSource(`${CHANGESET}\n### Contributors\n`, "none.md").contributors,
    [],
  );
});

test("rejects a contributor line that is not a login", () => {
  const source = `${CHANGESET}\n### Contributors\n\n- Alice Smith\n`;
  assert.throws(
    () => parseChangesetSource(source, "bad.md"),
    /Contributors accepts only "- @login" lines/u,
  );
});

test("rejects two contributor blocks", () => {
  const source = `${CHANGESET}\n### Contributors\n\n- @alice\n\n### Contributors\n\n- @bob\n`;
  assert.throws(() => parseChangesetSource(source, "twice.md"), /more than one/u);
});

test("marks the last bullet and appends one summary category per language", () => {
  const notes = notesFor([{ contributors: ["alice", "bob"] }]);
  const zh = renderLanguageSection("中文", notes.zh);
  const en = renderLanguageSection("English", notes.en);

  assert.match(zh, /- 第一条。\n- 第二条。（由 @alice、@bob 贡献）/u);
  assert.match(en, /- First\.\n- Second\. \(contributed by @alice and @bob\)/u);
  assert.match(zh, /\*\*贡献者\*\*\n\n- @alice\n- @bob/u);
  assert.match(en, /\*\*Contributors\*\*\n\n- @alice\n- @bob/u);
  assert.deepEqual([...notes.en.keys()].at(-1), "Contributors");
});

test("credits one summary entry per login across changesets", () => {
  const notes = notesFor([
    { contributors: ["alice"], label: "a.md" },
    { contributors: ["alice", "carol"], label: "b.md" },
  ]);
  const en = renderLanguageSection("English", notes.en);
  assert.match(en, /- Second\. \(contributed by @alice\)\n- First\./u);
  assert.match(en, /- Second\. \(contributed by @alice and @carol\)/u);
  assert.match(en, /\*\*Contributors\*\*\n\n- @alice\n- @carol/u);
  assert.equal(en.match(/- @alice/gu)?.length, 1);
});

test("does not credit a login the changeset text already names", () => {
  const source = CHANGESET.replace(
    "**修复**\n\n- 第一条。",
    "**修复**\n\n- 第一条，由 @alice 报告。",
  );
  const notes = notesFor([{ source, contributors: ["alice"] }]);
  const zh = renderLanguageSection("中文", notes.zh);
  assert.doesNotMatch(zh, /\*\*贡献者\*\*/u);
  assert.doesNotMatch(zh, /贡献）/u);
});

test("credits nobody for an empty contributor block", () => {
  const notes = notesFor([{ contributors: [] }]);
  const en = renderLanguageSection("English", notes.en);
  assert.doesNotMatch(en, /Contributors/u);
  assert.match(en, /- Second\.$/mu);
});
