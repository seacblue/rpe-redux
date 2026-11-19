/** Workspace pointer layers: interactive stage and inspector surfaces keep their paint order. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const freeCamera = read("src/frontend/screens/editor/workspace/stage/freeCamera/freeCamera.less");
const sampling = read("src/frontend/screens/editor/workspace/stage/sampling/sampling.less");
const curveEvents = read("src/frontend/screens/editor/curveEvents/curveEvents.less");
const shell = read("src/frontend/app/shell.less");

test("the sampler paints above the free-camera pointer layer", () => {
  assert.match(
    freeCamera,
    /\.stage\.free-camera-active > \.free-camera-layer\s*\{[\s\S]*?z-index:\s*calc\(var\(--z-content-overlay\)\s*\+\s*1\);/u,
    "the free-camera layer owns the active pointer surface on its rung",
  );
  assert.match(
    sampling,
    /\.sampling-overlay\s*\{[\s\S]*?z-index:\s*calc\(var\(--z-content-overlay\)\s*\+\s*2\);/u,
    "the sampler must stay above the free-camera layer that sampling borrows",
  );
});

test("curve preview removes the free-camera pointer layer", () => {
  assert.match(
    curveEvents,
    /\.stage\.curve-preview-active > \.free-camera-layer\s*\{[\s\S]*?display:\s*none;/u,
    "the curve edit canvas is the pointer surface in curve preview",
  );
});

test("the expanded inspector stays on the floating rung", () => {
  assert.match(
    shell,
    /\.workbench-inspector:has\(> \.inspector\[data-mode-surface="true"\]\)\s*\{[\s\S]*?z-index:\s*var\(--z-floating\);/u,
    "a task frame must paint above workspace pointer layers",
  );
});
