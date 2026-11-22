/** Verify bundled note PNGs have no transparent canvas padding. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const assetRoot = fileURLToPath(new URL("../../assets/skins/built_in_original/", import.meta.url));

/** Return the canvas size and non-transparent bounds of one bundled PNG. */
async function geometry(name) {
  const image = sharp(`${assetRoot}${name}`);
  const metadata = await image.metadata();
  const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = raw.info.width;
  let top = raw.info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < raw.info.height; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      if (raw.data[(y * raw.info.width + x) * 4 + 3] === 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    size: [metadata.width, metadata.height],
    alpha: [left, top, right + 1, bottom + 1],
  };
}

test("bundled note skins are cropped to their non-transparent bounds", async () => {
  const expected = {
    "click.png": { size: [993, 100], alpha: [0, 0, 993, 100] },
    "click_mh.png": { size: [1112, 238], alpha: [0, 0, 1112, 238] },
    "drag.png": { size: [945, 50], alpha: [0, 0, 945, 50] },
    "drag_mh.png": { size: [1062, 188], alpha: [0, 0, 1062, 188] },
    "flick.png": { size: [993, 172], alpha: [0, 0, 993, 172] },
    "flick_mh.png": { size: [1112, 298], alpha: [0, 0, 1112, 298] },
    "hold.png": { size: [999, 1100], alpha: [0, 0, 999, 1100] },
    "hold_mh.png": { size: [1138, 1215], alpha: [0, 0, 1138, 1215] },
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.deepEqual(await geometry(name), value, name);
  }
});
