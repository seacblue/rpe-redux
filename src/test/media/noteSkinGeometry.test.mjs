/** Note-skin geometry rules shared by the Phira parser and both renderers. */
import assert from "node:assert/strict";
import test from "node:test";
import { highlightWidthScale, phiraHoldAtlasSlices } from "../../core/media/noteSkin.ts";

test("Phira scales simultaneous notes by the click width ratio", () => {
  assert.equal(highlightWidthScale(998, 1148), 1148 / 998);
  assert.equal(highlightWidthScale(1089, 1089), 1);
});

test("a missing or invalid width keeps simultaneous notes at their base size", () => {
  assert.equal(highlightWidthScale(0, 1148), 1);
  assert.equal(highlightWidthScale(998, 0), 1);
});

test("Phira's Hold atlas puts the tail at the top and the head at the bottom", () => {
  assert.deepEqual(phiraHoldAtlasSlices(1100, [50, 50]), {
    tail: { y: 0, height: 50 },
    body: { y: 50, height: 1000 },
    head: { y: 1050, height: 50 },
  });
  assert.deepEqual(phiraHoldAtlasSlices(1250, [0, 130]), {
    tail: { y: 0, height: 0 },
    body: { y: 0, height: 1120 },
    head: { y: 1120, height: 130 },
  });
  // Phigros_Demo resource pack: a 985×354 Hold with only a 280px head.
  assert.deepEqual(phiraHoldAtlasSlices(354, [0, 280]), {
    tail: { y: 0, height: 0 },
    body: { y: 0, height: 74 },
    head: { y: 74, height: 280 },
  });
});

test("a Hold atlas needs a non-empty body", () => {
  assert.equal(phiraHoldAtlasSlices(100, [50, 50]), null);
  assert.equal(phiraHoldAtlasSlices(100, [-1, 50]), null);
});
