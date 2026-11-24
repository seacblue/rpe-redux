/** Verify bundled note PNGs retain the supplied pack geometry. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const assetRoot = fileURLToPath(
  new URL("../../assets/skins/builtin_reducer_cells/", import.meta.url),
);

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

test("bundled note skins retain their supplied geometry", async () => {
  const expected = {
    "click.png": { size: [989, 100], alpha: [0, 0, 989, 100] },
    "click_mh.png": { size: [1089, 200], alpha: [0, 0, 1089, 200] },
    "drag.png": { size: [989, 60], alpha: [0, 0, 989, 60] },
    "drag_mh.png": { size: [1089, 160], alpha: [1, 0, 1088, 160] },
    "flick.png": { size: [989, 200], alpha: [0, 0, 989, 200] },
    "flick_mh.png": { size: [1089, 300], alpha: [0, 8, 1089, 292] },
    "hold.png": { size: [989, 310], alpha: [0, 0, 989, 310] },
    "hold_mh.png": { size: [1089, 360], alpha: [6, 0, 1083, 360] },
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.deepEqual(await geometry(name), value, name);
  }
});
