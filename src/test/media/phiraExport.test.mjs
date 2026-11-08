/**
 * Phira export keeps the Redux event-bar texture and normalizes the judge-line
 * image to the package-root path Redux discovers on re-import. A package that is
 * not a Phira respack is rejected because there is no other skin format.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhiraWorkbenchFiles,
  PHIRA_WORKBENCH_SLOTS,
} from "../../core/media/phiraSkinDraft.ts";
import { parsePhiraRespack } from "../../core/media/phiraRespack.ts";
import { phiraExportFiles } from "../../frontend/screens/settings/skin/phiraExport.ts";

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

/** A complete workbench package with valid Hold and hit-effect geometry. */
function completeFiles() {
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
  return buildPhiraWorkbenchFiles({ name: "Export test", draft });
}

test("export keeps event_hold and moves a legacy judge line to the package root", async () => {
  const files = completeFiles();
  const manifest = parsePhiraRespack(files).manifest;
  const canonical = manifest.judgeline?.line.file;
  assert.ok(canonical, "the workbench package has no judge-line texture");
  const lineBytes = files.get(canonical);
  assert.ok(lineBytes, `the judge-line texture ${canonical} is missing`);
  // Simulate an older package that stores the judge line under `judgeline/`.
  files.delete(canonical);
  files.set("judgeline/line.png", lineBytes);
  manifest.judgeline = {
    line: { file: "judgeline/line.png", useful: manifest.judgeline.line.useful },
  };

  const exported = await phiraExportFiles({ id: "test", manifest, files });
  assert.ok(exported.has("event_hold.png"), "event_hold.png was dropped from the export");
  assert.ok(exported.has("line.png"), "the judge line was not normalized to the package root");
  assert.equal(
    exported.has("judgeline/line.png"),
    false,
    "the old judge-line path survived the export",
  );
  assert.deepEqual(exported.get("line.png"), lineBytes);

  const info = new TextDecoder().decode(exported.get("info.yml"));
  assert.match(info, /eventHold: "event_hold\.png"/);
  const reparsed = parsePhiraRespack(exported);
  assert.equal(reparsed.manifest.judgeline?.line.file, "line.png");
  assert.ok(reparsed.manifest.events.event_hold, "the event bar did not survive the export");
});

test("export writes a package event texture at the canonical event_hold.png", async () => {
  const files = completeFiles();
  const manifest = parsePhiraRespack(files).manifest;
  const eventBytes = files.get("event_hold.png");
  assert.ok(eventBytes, "the workbench package has no event texture");
  files.delete("event_hold.png");
  files.set("custom-event.png", eventBytes);
  manifest.events.event_hold = { file: "custom-event.png" };
  manifest.phira.info.eventHold = "custom-event.png";

  const exported = await phiraExportFiles({ id: "test", manifest, files });
  assert.deepEqual(exported.get("event_hold.png"), eventBytes);
  const info = new TextDecoder().decode(exported.get("info.yml"));
  assert.match(info, /eventHold: "event_hold\.png"/);
  const reparsed = parsePhiraRespack(exported);
  assert.equal(reparsed.manifest.events.event_hold?.file, "event_hold.png");
});

test("export rejects a package that is not a Phira respack", async () => {
  const legacy = {
    id: "legacy",
    manifest: { name: "Legacy skin", notes: { tap: { file: "tap.png" } }, events: {} },
    files: new Map([["tap.png", png(8, 8)]]),
  };
  await assert.rejects(() => phiraExportFiles(legacy), /Only Phira resource packs can be exported/);
});
