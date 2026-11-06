/** Verifies release-note language selection and block parsing. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReleaseNoteBlocks,
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
    { kind: "paragraph", text: "Line one Line two" },
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
  assert.deepEqual(firstList.items, ["Fix one.", "Fix two."]);
  const changes = blocks[3];
  assert.equal(changes?.kind, "list");
  assert.deepEqual(changes.items, ["Change three."]);
});

test("skips empty blocks", () => {
  assert.deepEqual(parseReleaseNoteBlocks("\n\n"), []);
});
