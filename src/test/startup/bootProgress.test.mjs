/** The startup splash reports the same numbers the build measured. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bootAssetIndex,
  bootAssetKey,
  bootTransferRate,
  formatByteSize,
  formatTransferRate,
  isBootResource,
  isUiResource,
  summarizeBootProgress,
} from "../../frontend/screens/startup/bootProgress.ts";

const base = "https://example.test/app/";
const first = "https://example.test/app/a.js";
const second = "https://example.test/app/b.css";

/** One completed script entry. */
function script(name, bytes, transferSize = bytes) {
  return {
    name,
    initiatorType: "script",
    transferSize,
    encodedBodySize: bytes,
    decodedBodySize: bytes,
    startTime: 0,
    responseEnd: 10,
  };
}

test("asset keys resolve against the document base", () => {
  assert.equal(bootAssetKey("./assets/index.js", base), first.replace("a.js", "assets/index.js"));
  assert.equal(bootAssetKey("/assets/index.js", base), "https://example.test/assets/index.js");
});

test("the manifest index keeps only positive sizes and absolute keys", () => {
  const index = bootAssetIndex({ "./a.js": 100, "./b.css": 50, "./empty.js": 0 }, base);
  assert.deepEqual([...index.keys()].sort(), [first, second].sort());
  assert.equal(index.get(first), 100);
  assert.equal(index.get(second), 50);
});

test("manifest progress counts decompressed bytes and ignores unlisted files", () => {
  const assets = bootAssetIndex({ "./a.js": 100, "./b.css": 50 }, base);
  const snapshot = summarizeBootProgress(
    [script(first, 100, 40), script("https://example.test/app/extra.js", 10, 10)],
    assets,
  );
  assert.equal(snapshot.totalBytes, 150);
  assert.equal(snapshot.loadedBytes, 100);
  assert.equal(snapshot.transferredBytes, 40);
  assert.equal(snapshot.loadedAssets, 1);
  assert.equal(snapshot.totalAssets, 2);
  assert.equal(snapshot.observedAssets, 1);
  assert.equal(snapshot.ratio, 100 / 150);
  assert.equal(snapshot.complete, false);
});

test("a complete manifest reports full progress once every file arrives", () => {
  const assets = bootAssetIndex({ "./a.js": 100, "./b.css": 50 }, base);
  const snapshot = summarizeBootProgress(
    [script(first, 100, 40), { ...script(second, 50, 20), initiatorType: "link" }],
    assets,
  );
  assert.equal(snapshot.loadedBytes, 150);
  assert.equal(snapshot.transferredBytes, 60);
  assert.equal(snapshot.loadedAssets, 2);
  assert.equal(snapshot.ratio, 1);
  assert.equal(snapshot.complete, true);
});

test("without a manifest the report counts scripts and stylesheets only", () => {
  const snapshot = summarizeBootProgress(
    [
      script(first, 100, 40),
      script("https://example.test/app/component.ts", 30, 20),
      { ...script("https://example.test/app/style.css", 8, 5), initiatorType: "link" },
      { ...script("https://example.test/app/font.otf", 100, 100), initiatorType: "css" },
      { ...script("https://example.test/app/api/health", 1, 1), initiatorType: "fetch" },
    ],
    new Map(),
  );
  assert.equal(snapshot.totalAssets, 0);
  assert.equal(snapshot.totalBytes, 0);
  assert.equal(snapshot.loadedBytes, 138);
  assert.equal(snapshot.transferredBytes, 65);
  assert.equal(snapshot.observedAssets, 3);
  assert.equal(snapshot.ratio, 0);
  assert.equal(snapshot.complete, false);
});

test("duplicate entries count once and missing body sizes fall back to the built size", () => {
  const assets = bootAssetIndex({ "./a.js": 100, "./b.css": 50 }, base);
  const duplicate = {
    name: first,
    initiatorType: "script",
    transferSize: 0,
    encodedBodySize: 0,
    decodedBodySize: 0,
    responseEnd: 10,
  };
  const snapshot = summarizeBootProgress(
    [
      duplicate,
      duplicate,
      {
        name: second,
        initiatorType: "link",
        transferSize: 0,
        encodedBodySize: 50,
        decodedBodySize: 0,
        responseEnd: 11,
      },
    ],
    assets,
  );
  assert.equal(snapshot.loadedAssets, 2);
  assert.equal(snapshot.loadedBytes, 150);
  assert.equal(snapshot.transferredBytes, 0);
  assert.equal(snapshot.complete, true);
});

test("a blocked or failed response does not complete a manifest entry", () => {
  const assets = bootAssetIndex({ "./a.js": 100 }, base);
  const snapshot = summarizeBootProgress(
    [
      {
        ...script(first, 0, 0),
        responseStatus: 0,
        decodedBodySize: 0,
        encodedBodySize: 0,
        transferSize: 0,
      },
    ],
    assets,
  );
  assert.equal(snapshot.loadedAssets, 0);
  assert.equal(snapshot.loadedBytes, 0);
  assert.equal(snapshot.complete, false);
});

test("a body larger than the built file cannot push progress past the total", () => {
  const assets = bootAssetIndex({ "./a.js": 100 }, base);
  const snapshot = summarizeBootProgress([script(first, 200, 120)], assets);
  assert.equal(snapshot.loadedBytes, 100);
  assert.equal(snapshot.transferredBytes, 120);
  assert.equal(snapshot.ratio, 1);
});

test("transfer rate uses the elapsed boot window", () => {
  assert.equal(bootTransferRate({ transferredBytes: 1000 }, 500), 2000);
  assert.equal(bootTransferRate({ transferredBytes: 0 }, 500), 0);
  assert.equal(bootTransferRate({ transferredBytes: 100 }, 0), 0);
});

test("byte and rate formatting stays readable across units", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(512), "512 B");
  assert.equal(formatByteSize(1024), "1.0 KB");
  assert.equal(formatByteSize(1536), "1.5 KB");
  assert.equal(formatByteSize(356 * 1024), "356 KB");
  assert.equal(formatByteSize(4.5 * 1024 * 1024), "4.5 MB");
  assert.equal(formatTransferRate(0), null);
  assert.equal(formatTransferRate(1536), "1.5 KB/s");
});

test("boot resources exclude fonts, images, and API traffic", () => {
  assert.equal(isBootResource({ name: first, initiatorType: "script" }), true);
  assert.equal(isBootResource({ name: second, initiatorType: "link" }), true);
  assert.equal(
    isBootResource({ name: "https://example.test/app/font.woff2", initiatorType: "link" }),
    false,
  );
  assert.equal(
    isBootResource({ name: "https://example.test/app/health", initiatorType: "fetch" }),
    false,
  );
});

test("surface loading includes images, fonts, and library resources", () => {
  assert.equal(
    isUiResource({ name: "https://example.test/cover.png", initiatorType: "img" }),
    true,
  );
  assert.equal(
    isUiResource({ name: "https://example.test/font.woff2", initiatorType: "css" }),
    true,
  );
  assert.equal(
    isUiResource({ name: "https://example.test/api/library/asset", initiatorType: "fetch" }),
    true,
  );
  assert.equal(
    isUiResource({ name: "https://example.test/api/health", initiatorType: "fetch" }),
    false,
  );
  assert.equal(
    isUiResource({ name: "https://example.test/api/preferences", initiatorType: "fetch" }),
    false,
  );

  const snapshot = summarizeBootProgress(
    [
      script(first, 100, 40),
      {
        name: "https://example.test/cover.png",
        initiatorType: "img",
        transferSize: 20,
        decodedBodySize: 30,
        responseEnd: 10,
      },
      {
        name: "https://example.test/font.woff2",
        initiatorType: "css",
        transferSize: 100,
        decodedBodySize: 200,
        responseEnd: 11,
      },
      {
        name: "https://example.test/api/library/asset",
        initiatorType: "fetch",
        transferSize: 50,
        decodedBodySize: 60,
        responseEnd: 12,
      },
      {
        name: "https://example.test/api/health",
        initiatorType: "fetch",
        transferSize: 1,
        decodedBodySize: 1,
        responseEnd: 13,
      },
    ],
    new Map(),
    isUiResource,
  );
  assert.equal(snapshot.observedAssets, 4);
  assert.equal(snapshot.loadedBytes, 390);
  assert.equal(snapshot.transferredBytes, 210);
});
