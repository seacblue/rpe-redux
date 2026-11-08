/**
 * The skin workbench's package assembly: every canonical slot reaches
 * `info.yml`, complete boards validate, partial boards omit unusable slots, and
 * an existing pack round-trips back into the same slots.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhiraWorkbenchFiles,
  missingPhiraWorkbenchSlots,
  phiraWorkbenchDraftFromPack,
  phiraWorkbenchExtrasFromPack,
  PHIRA_WORKBENCH_FILES,
  PHIRA_WORKBENCH_SLOTS,
} from "../../core/media/phiraSkinDraft.ts";
import { parsePhiraRespack } from "../../core/media/phiraRespack.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** A header-valid PNG; the parser only reads PNG dimensions from the IHDR chunk. */
function png(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A complete draft with valid Hold atlases and a valid hit-effect grid. */
function completeDraft() {
  const draft = {};
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    if (slot === "tap_sound" || slot === "drag_sound" || slot === "flick_sound") {
      draft[slot] = { bytes: new Uint8Array([1, 2, 3]), fileName: `${slot}.ogg` };
    } else if (slot === "hold") {
      draft[slot] = {
        bytes: png(4, 12),
        fileName: "hold.png",
        width: 4,
        height: 12,
        atlas: [3, 3],
      };
    } else if (slot === "hold_highlight") {
      draft[slot] = {
        bytes: png(4, 14),
        fileName: "hold_mh.png",
        width: 4,
        height: 14,
        atlas: [4, 4],
      };
    } else if (slot === "hit_fx") {
      draft[slot] = {
        bytes: png(8, 4),
        fileName: "hit_fx.png",
        width: 8,
        height: 4,
        grid: [4, 2],
      };
    } else {
      draft[slot] = { bytes: png(8, 8), fileName: `${slot}.png`, width: 8, height: 8 };
    }
  }
  return draft;
}

test("a complete draft writes every canonical Phira file", () => {
  const files = buildPhiraWorkbenchFiles({
    name: "Workbench test",
    draft: completeDraft(),
    baseInfo: { author: "Test Author" },
  });
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    assert.ok(files.has(PHIRA_WORKBENCH_FILES[slot]), `${slot} is missing its file`);
  }
  const parsed = parsePhiraRespack(files);
  assert.equal(parsed.info.name, "Workbench test");
  assert.equal(parsed.info.author, "Test Author");
  assert.deepEqual(parsed.info.holdAtlas, [3, 3]);
  assert.deepEqual(parsed.info.holdAtlasMH, [4, 4]);
  assert.deepEqual(parsed.info.hitFx, [4, 2]);
  assert.equal(parsed.info.eventHold, "event_hold.png");
  assert.deepEqual(missingPhiraWorkbenchSlots(completeDraft()), []);
});

test("an incomplete board can be saved with missing and unusable slots omitted", () => {
  const draft = completeDraft();
  delete draft.tap;
  draft.hold = { ...draft.hold, atlas: [8, 4] };
  const files = buildPhiraWorkbenchFiles({
    name: "Partial",
    draft,
    allowIncomplete: true,
  });
  assert.equal(files.has("click.png"), false, "missing tap was written");
  assert.equal(files.has("hold.png"), false, "invalid hold was written");
  const parsed = parsePhiraRespack(files, { allowIncomplete: true });
  assert.equal(parsed.manifest.notes.tap, undefined);
  assert.equal(parsed.manifest.notes.hold_head, undefined);
  assert.equal(parsed.manifest.notes.drag.file, "drag.png");
});

test("an incomplete board and invalid geometry are refused", () => {
  const missing = completeDraft();
  delete missing.tap;
  assert.throws(
    () => buildPhiraWorkbenchFiles({ name: "Incomplete", draft: missing }),
    /Missing skin assets: tap/,
  );

  const grid = completeDraft();
  grid.hit_fx = { ...grid.hit_fx, grid: [3, 2] };
  assert.throws(
    () => buildPhiraWorkbenchFiles({ name: "Bad grid", draft: grid }),
    /hit-effect atlas needs its frame grid/,
  );

  const atlas = completeDraft();
  atlas.hold = { ...atlas.hold, atlas: [8, 4] };
  assert.throws(
    () => buildPhiraWorkbenchFiles({ name: "Bad atlas", draft: atlas }),
    /hold atlas needs its cut heights/,
  );
});

test("a built package reads back into the same slots", () => {
  const files = buildPhiraWorkbenchFiles({ name: "Round trip", draft: completeDraft() });
  files.set("ending.mp3", new Uint8Array([1, 2, 3]));
  const manifest = parsePhiraRespack(files).manifest;
  const draft = phiraWorkbenchDraftFromPack({ manifest, files });
  assert.deepEqual(missingPhiraWorkbenchSlots(draft), []);
  assert.deepEqual(draft.hold?.atlas, [3, 3]);
  assert.deepEqual(draft.hold_highlight?.atlas, [4, 4]);
  assert.deepEqual(draft.hit_fx?.grid, [4, 2]);
  assert.equal(draft.event_hold?.fileName, "event_hold.png");
  assert.equal(draft.judgeline?.fileName, "line.png");
  assert.equal(draft.tap_sound?.fileName, "click.ogg");

  const extras = phiraWorkbenchExtrasFromPack({ manifest, files });
  assert.deepEqual([...extras.keys()], ["ending.mp3"]);
  const rebuilt = buildPhiraWorkbenchFiles({
    name: "Round trip",
    draft,
    extras,
  });
  assert.deepEqual(rebuilt.get("ending.mp3"), new Uint8Array([1, 2, 3]));
});
