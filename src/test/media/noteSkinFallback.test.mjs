/**
 * Runtime fallback composition: a partial skin borrows missing slots from the
 * built-in package and then the first installed skin that provides them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NOTE_SKIN,
  loadNoteSkinWithFallback,
  setBundledNoteSkinLoader,
  setExternalNoteSkinLoader,
  setNoteSkinFallbackSources,
  unresolvedNoteSkinSlots,
} from "../../core/media/noteSkins.ts";
import {
  buildPhiraWorkbenchFiles,
  missingPhiraWorkbenchSlots,
  phiraWorkbenchDraftFromPack,
  PHIRA_WORKBENCH_SLOTS,
} from "../../core/media/phiraSkinDraft.ts";
import { parsePhiraRespack } from "../../core/media/phiraRespack.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

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

function completeDraft() {
  const draft = {};
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    if (slot === "tap_sound" || slot === "drag_sound" || slot === "flick_sound") {
      draft[slot] = { bytes: new Uint8Array([79, 103, 103, 83]), fileName: `${slot}.ogg` };
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

function pack(id, name, draft) {
  const files = buildPhiraWorkbenchFiles({ name, draft, allowIncomplete: true });
  return {
    id,
    files,
    manifest: parsePhiraRespack(files, { allowIncomplete: true }).manifest,
  };
}

function withoutTap(name) {
  const draft = completeDraft();
  delete draft.tap;
  return pack("", name, draft);
}

test("a partial skin borrows missing slots from the built-in package", async () => {
  const active = withoutTap("Partial");
  active.id = "external:partial";
  const builtIn = pack(DEFAULT_NOTE_SKIN, "Built-in", completeDraft());
  setBundledNoteSkinLoader(async () => builtIn);
  setExternalNoteSkinLoader(async (id) => {
    if (id === "partial") {
      return active;
    }
    throw new Error(`unexpected skin ${id}`);
  });
  setNoteSkinFallbackSources(() => [DEFAULT_NOTE_SKIN]);

  try {
    const merged = await loadNoteSkinWithFallback("external:partial");
    assert.equal(merged.id, "external:partial");
    assert.ok(merged.manifest.notes.tap, "the built-in tap texture was not copied");
    assert.ok(merged.files.has("click.png"), "the canonical click.png file is missing");
    assert.deepEqual(missingPhiraWorkbenchSlots(phiraWorkbenchDraftFromPack(merged)), []);
  } finally {
    setBundledNoteSkinLoader(null);
    setExternalNoteSkinLoader(null);
    setNoteSkinFallbackSources(null);
  }
});

test("unresolved slots survive when no source provides them", async () => {
  const active = withoutTap("Partial");
  active.id = "external:partial";
  const builtIn = withoutTap("Built-in partial");
  const source = withoutTap("Source partial");
  source.id = "external:source";
  setBundledNoteSkinLoader(async () => builtIn);
  setExternalNoteSkinLoader(async (id) => {
    if (id === "partial") {
      return active;
    }
    if (id === "source") {
      return source;
    }
    throw new Error(`unexpected skin ${id}`);
  });
  setNoteSkinFallbackSources(() => [DEFAULT_NOTE_SKIN, "external:source"]);

  try {
    assert.deepEqual(await unresolvedNoteSkinSlots("external:partial"), ["tap"]);
  } finally {
    setBundledNoteSkinLoader(null);
    setExternalNoteSkinLoader(null);
    setNoteSkinFallbackSources(null);
  }
});
