/** Verifies manifest asset paths, MIME mapping, data URLs, and validation. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  assetDataUrl,
  assetDimensions,
  assetMime,
  isSafeAssetPath,
  manifestAssetNames,
} from "../../../core/extensions/assets.ts";
import {
  validateManifest,
  materializeManifest,
} from "../../../core/extensions/extensionRuntimeSupport.ts";
import { assetDigest, extensionFingerprint } from "../../../frontend/platform/extensionTrust.ts";

const base = {
  id: "demo.pet",
  name: "Demo",
  version: "1.0.0",
  engines: { "rpe-redux": ">=1.0.0 <2.0.0" },
  entry: "index.js",
};

test("media asset paths stay relative and use an image extension", () => {
  assert.equal(isSafeAssetPath("assets/idle.svg"), true);
  assert.equal(isSafeAssetPath("assets/pet-1.gif"), true);
  assert.equal(isSafeAssetPath("assets/../secret.png"), false);
  assert.equal(isSafeAssetPath("C:/secret.png"), false);
  assert.equal(isSafeAssetPath("assets/secret.txt"), false);
  assert.equal(isSafeAssetPath("assets\\secret.png"), false);
  assert.equal(isSafeAssetPath("https://example.com/pet.png"), false);
});

test("asset MIME and data URLs are derived from the declared path", () => {
  assert.equal(assetMime("assets/pet.gif"), "image/gif");
  assert.equal(assetMime("assets/pet.svg"), "image/svg+xml");
  assert.equal(assetMime("assets/pet.unknown"), "application/octet-stream");
  assert.equal(
    assetDataUrl("assets/pet.svg", new TextEncoder().encode("<svg/>")),
    "data:image/svg+xml;base64,PHN2Zy8+",
  );
});

test("manifest validation accepts bounded assets and rejects unsafe declarations", () => {
  const manifest = {
    ...base,
    assets: { idle: "assets/idle.svg", wave: "assets/wave.svg" },
  };
  assert.equal(validateManifest(manifest, "1.0.14"), null);
  assert.deepEqual(manifestAssetNames(manifest), ["idle", "wave"]);

  const unsafe = {
    ...base,
    assets: { idle: "../idle.svg" },
  };
  const result = validateManifest(unsafe, "1.0.14");
  assert.equal(result?.code, "invalidAssets");

  const badName = {
    ...base,
    assets: { "../idle": "assets/idle.svg" },
  };
  assert.equal(validateManifest(badName, "1.0.14")?.code, "invalidAssets");
});

test("asset dimensions are read from common image headers", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngView = new DataView(png.buffer);
  pngView.setUint32(16, 64);
  pngView.setUint32(20, 32);
  assert.deepEqual(assetDimensions("pet.png", png), { width: 64, height: 32 });

  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 12, 0, 8, 0]);
  assert.deepEqual(assetDimensions("pet.gif", gif), { width: 12, height: 8 });

  const jpeg = new Uint8Array(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 2, 0, 3]);
  assert.deepEqual(assetDimensions("pet.jpg", jpeg), { width: 3, height: 2 });

  const bmp = new Uint8Array(26);
  bmp.set([0x42, 0x4d]);
  const bmpView = new DataView(bmp.buffer);
  bmpView.setInt32(18, 40, true);
  bmpView.setInt32(22, -20, true);
  assert.deepEqual(assetDimensions("pet.bmp", bmp), { width: 40, height: 20 });

  assert.deepEqual(
    assetDimensions(
      "pet.svg",
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>',
      ),
    ),
    { width: 120, height: 80 },
  );
  assert.equal(assetDimensions("pet.png", new Uint8Array([1, 2, 3])), null);
});

test("manifest asset metadata is bounded and must name a declared asset", () => {
  const manifest = {
    ...base,
    assets: { idle: "assets/idle.png" },
    assetMetadata: {
      idle: { frameWidth: 32, frameHeight: 32, columns: 4, rows: 2, frameCount: 8 },
    },
  };
  assert.equal(validateManifest(manifest, "1.0.14"), null);
  assert.equal(
    validateManifest(
      { ...manifest, assetMetadata: { missing: { frameWidth: 32, frameHeight: 32 } } },
      "1.0.14",
    )?.code,
    "invalidAssets",
  );
  assert.equal(
    validateManifest(
      { ...manifest, assetMetadata: { idle: { frameWidth: 0, frameHeight: 32 } } },
      "1.0.14",
    )?.code,
    "invalidAssets",
  );
  assert.equal(
    validateManifest(
      {
        ...manifest,
        assetMetadata: { idle: { frameWidth: 32, frameHeight: 32, padding: 4 } },
      },
      "1.0.14",
    )?.code,
    "invalidAssets",
  );
});

test("asset bytes participate in the package fingerprint", async () => {
  const first = await assetDigest([
    { name: "idle", path: "assets/idle.svg", bytes: new TextEncoder().encode("<svg/>") },
  ]);
  const second = await assetDigest([
    {
      name: "idle",
      path: "assets/idle.svg",
      bytes: new TextEncoder().encode("<svg>changed</svg>"),
    },
  ]);
  assert.notEqual(first, second);
  const withoutAssets = await extensionFingerprint("manifest", undefined, "entry");
  const withAssets = await extensionFingerprint("manifest", undefined, "entry", first);
  assert.notEqual(withoutAssets, withAssets);
});

test("a package directory ships every declared asset", () => {
  const root = new URL("../../../assets/extensions/builtin.official/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
  const i18n = JSON.parse(readFileSync(new URL("i18n.json", root), "utf8"));
  assert.equal(validateManifest(materializeManifest(manifest, i18n), "1.0.14"), null);
  for (const relative of Object.values(manifest.assets ?? {})) {
    assert.equal(existsSync(new URL(relative, root)), true);
  }
});
