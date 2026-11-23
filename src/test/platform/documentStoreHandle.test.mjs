/** Verify native and library asset bindings expose the same shader-facing contract. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCurrentDocumentAssets,
  bindCurrentDocumentStore,
  currentDocumentAssetNames,
} from "../../frontend/platform/documentStoreHandle.ts";
import { readShaderSource } from "../../frontend/platform/shaderSource.ts";

function assetMap(name, source) {
  const bytes = new TextEncoder().encode(source);
  const assets = new Map([[name, bytes]]);
  assets.names = () => [name];
  assets.read = async (requested) => assets.get(requested);
  return assets;
}

test("shader loading reads the map owned by a native asset store", async () => {
  const assets = assetMap("shaders/custom.glsl", "void main() {}");
  const release = bindCurrentDocumentStore({
    assets: { assets, names: new Set(["shaders/custom.glsl"]) },
  });
  try {
    assert.equal(await readShaderSource("shaders/custom.glsl"), "void main() {}");
  } finally {
    release();
  }
});

test("library asset bindings provide names to inspector surfaces", () => {
  const assets = assetMap("shaders/custom.glsl", "void main() {}");
  const release = bindCurrentDocumentAssets(assets);
  try {
    assert.deepEqual([...currentDocumentAssetNames()], ["shaders/custom.glsl"]);
  } finally {
    release();
  }
});
