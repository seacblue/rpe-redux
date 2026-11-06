/** Verifies release-note language selection, inline styling, and block parsing. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RELEASE_NOTE_COLORS,
  formatReleaseDate,
  parseReleaseNoteBlocks,
  parseReleaseNoteInline,
  selectChangelogRelease,
  selectLanguageNotes,
} from "../frontend/screens/settings/updates/releaseNotes.ts";

const BILINGUAL = `### 中文

**修复**

- 修复甲。
- 修复乙。

**调整**

- 调整丙。

### English

**Fixes**

- Fix one.
- Fix two.

**Changes**

- Change three.
`;

/** Flatten parsed inline spans back to their visible text. */
function flatten(nodes) {
  return nodes
    .map((node) => {
      if (node.kind === "text") {
        return node.text;
      }
      if (node.kind === "mention") {
        return `@${node.name}`;
      }
      return flatten(node.content);
    })
    .join("");
}

test("selects the Chinese section of a bilingual release body", () => {
  const notes = selectLanguageNotes(BILINGUAL, "zh");
  assert.match(notes, /修复甲/u);
  assert.match(notes, /调整丙/u);
  assert.doesNotMatch(notes, /Fix one/u);
  assert.doesNotMatch(notes, /###/u);
});

test("selects the English section of a bilingual release body", () => {
  const notes = selectLanguageNotes(BILINGUAL, "en");
  assert.match(notes, /Fix one/u);
  assert.match(notes, /Change three/u);
  assert.doesNotMatch(notes, /修复甲/u);
  assert.doesNotMatch(notes, /###/u);
});

test("leaves a body without language headings unchanged", () => {
  const plain = "A short note.\n\n- one\n- two";
  assert.equal(selectLanguageNotes(plain, "zh"), plain);
});

test("keeps free-form text as one paragraph", () => {
  assert.deepEqual(parseReleaseNoteBlocks("Line one\nLine two"), [
    { kind: "paragraph", content: [{ kind: "text", text: "Line one Line two" }] },
  ]);
});

test("parses headings and bullets from the selected language", () => {
  const blocks = parseReleaseNoteBlocks(selectLanguageNotes(BILINGUAL, "en"));
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "list", "heading", "list"],
  );
  const firstList = blocks[1];
  assert.equal(firstList?.kind, "list");
  assert.equal(firstList.items.length, 2);
  assert.equal(flatten(firstList.items[0]), "Fix one.");
  const changes = blocks[3];
  assert.equal(changes?.kind, "list");
  assert.equal(flatten(changes.items[0]), "Change three.");
});

test("skips empty blocks", () => {
  assert.deepEqual(parseReleaseNoteBlocks("\n\n"), []);
});

test("renders @name credits as mentions", () => {
  assert.deepEqual(parseReleaseNoteInline("感谢 @seacblue 的修复。"), [
    { kind: "text", text: "感谢 " },
    { kind: "mention", name: "seacblue" },
    { kind: "text", text: " 的修复。" },
  ]);
  assert.deepEqual(parseReleaseNoteInline("感谢@seacblue的修复"), [
    { kind: "text", text: "感谢" },
    { kind: "mention", name: "seacblue" },
    { kind: "text", text: "的修复" },
  ]);
  assert.deepEqual(parseReleaseNoteInline("@rpe-redux"), [{ kind: "mention", name: "rpe-redux" }]);
});

test("keeps addresses that merely contain @ as plain text", () => {
  assert.deepEqual(parseReleaseNoteInline("foo@bar.com"), [{ kind: "text", text: "foo@bar.com" }]);
});

test("parses colour runs with their canonical colour name", () => {
  assert.deepEqual(parseReleaseNoteInline("A <red>critical</red> fix"), [
    { kind: "text", text: "A " },
    {
      kind: "color",
      color: "red",
      content: [{ kind: "text", text: "critical" }],
    },
    { kind: "text", text: " fix" },
  ]);
});

test("accepts the semantic colour aliases", () => {
  const [danger] = parseReleaseNoteInline("<danger>danger</danger>");
  assert.equal(danger?.kind, "color");
  assert.equal(danger.color, "red");
  const [warning] = parseReleaseNoteInline("<warning>warning</warning>");
  assert.equal(warning?.kind, "color");
  assert.equal(warning.color, "yellow");
  const [grey] = parseReleaseNoteInline("<grey>grey</grey>");
  assert.equal(grey?.kind, "color");
  assert.equal(grey.color, "gray");
});

test("parses every palette colour name", () => {
  for (const color of RELEASE_NOTE_COLORS) {
    assert.deepEqual(parseReleaseNoteInline(`<${color}>x</${color}>`), [
      { kind: "color", color, content: [{ kind: "text", text: "x" }] },
    ]);
  }
});

test("nests a mention inside a colour run", () => {
  assert.deepEqual(parseReleaseNoteInline("<green>thanks @seacblue</green>"), [
    {
      kind: "color",
      color: "green",
      content: [
        { kind: "text", text: "thanks " },
        { kind: "mention", name: "seacblue" },
      ],
    },
  ]);
});

test("keeps unknown or unbalanced annotations literal", () => {
  assert.equal(flatten(parseReleaseNoteInline("<nope>x</nope>")), "<nope>x</nope>");
  assert.equal(flatten(parseReleaseNoteInline("<red>x")), "<red>x");
  assert.equal(flatten(parseReleaseNoteInline("</red>x")), "</red>x");
  assert.equal(flatten(parseReleaseNoteInline("a < b")), "a < b");
});

test("parses inline annotations inside a heading", () => {
  const blocks = parseReleaseNoteBlocks("**<red>Fixes</red>**");
  assert.equal(blocks.length, 1);
  const heading = blocks[0];
  assert.equal(heading?.kind, "heading");
  assert.deepEqual(heading.content, [
    {
      kind: "color",
      color: "red",
      content: [{ kind: "text", text: "Fixes" }],
    },
  ]);
});

test("formats a release timestamp as year-month-day", () => {
  assert.equal(formatReleaseDate("2026-11-06T12:00:00Z"), "2026-11-6");
  assert.equal(formatReleaseDate("2026-01-05"), "2026-1-5");
  assert.equal(formatReleaseDate(""), "");
  assert.equal(formatReleaseDate("not a date"), "");
});

test("selects the running version's release when it has notes", () => {
  const releases = [
    { version: "1.0.2", publishedAt: "2026-11-07T00:00:00Z", notes: BILINGUAL },
    { version: "1.0.1", publishedAt: "2026-11-06T12:00:00Z", notes: BILINGUAL },
  ];
  const current = selectChangelogRelease(releases, "1.0.1", "zh");
  assert.equal(current?.version, "1.0.1");
  assert.equal(current?.publishedAt, "2026-11-06T12:00:00Z");
  assert.match(current?.notes ?? "", /修复甲/u);
  assert.doesNotMatch(current?.notes ?? "", /Fix one/u);
});

test("falls back to the newest release with readable notes", () => {
  const releases = [
    {
      version: "1.0.3",
      publishedAt: "2026-11-08T00:00:00Z",
      notes: "### 中文\n\n**修复**\n\n- 甲。\n",
    },
    { version: "1.0.2", publishedAt: "2026-11-07T00:00:00Z", notes: BILINGUAL },
  ];
  const fallback = selectChangelogRelease(releases, "9.9.9", "en");
  assert.equal(fallback?.version, "1.0.2");
  assert.match(fallback?.notes ?? "", /Fix one/u);
});

test("returns null when no release has notes for the language", () => {
  assert.equal(selectChangelogRelease([], "1.0.1", "zh"), null);
  const partial = [
    { version: "1.0.1", publishedAt: "2026-11-06T00:00:00Z", notes: "### 中文\n\n- 甲。\n" },
  ];
  assert.equal(selectChangelogRelease(partial, "1.0.1", "en"), null);
});
