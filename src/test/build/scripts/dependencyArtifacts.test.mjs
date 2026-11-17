/**
 * Verifies the dependency release resolver: it reads vendor checksum files,
 * selects the newest release branch, and refuses an artifact whose publisher
 * publishes no digest, so the staging scripts only download verified bytes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  findArchiveRoot,
  parseChecksums,
  parseDigest,
  parseVersion,
  selectNewestBranch,
  selectReleaseAsset,
} from "../../../../scripts/dependencyArtifacts.mjs";

const LINUX_PATTERN = /^ffmpeg-n(\d+\.\d+)-latest-linux64-gpl-(\d+\.\d+)\.tar\.xz$/u;

test("checksum files are parsed for every sha256sum spelling", () => {
  const text = [
    "51e5f4592db783f9d140d138eee5bd327502e43951e4f70880a16571a9a1fe73  ffmpeg-n7.1-latest-win32-gpl-7.1.zip",
    "406EDDB53777BAF077F3FA4276C34B5AABD51C1AC9169F37602A230ADF42BA7E *ffmpeg-n8.1-latest-win32-gpl-8.1.zip",
    "  # a comment line",
    "not-a-digest  ffmpeg-ignored.zip",
    "",
  ].join("\r\n");

  const checksums = parseChecksums(text);

  assert.equal(
    checksums.get("ffmpeg-n7.1-latest-win32-gpl-7.1.zip"),
    "51e5f4592db783f9d140d138eee5bd327502e43951e4f70880a16571a9a1fe73",
  );
  assert.equal(
    checksums.get("ffmpeg-n8.1-latest-win32-gpl-8.1.zip"),
    "406eddb53777baf077f3fa4276c34b5aabd51c1ac9169f37602a230adf42ba7e",
  );
  assert.equal(checksums.has("ffmpeg-ignored.zip"), false);
  assert.equal(checksums.size, 2);
});

test("the newest release branch wins over an older one", () => {
  const names = [
    "ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz",
    "ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz",
    "ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz",
  ];

  assert.deepEqual(selectNewestBranch(names, LINUX_PATTERN, "BtbN linux64 GPL"), {
    name: "ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz",
    branch: "9.0",
  });
});

test("non-GPL, shared, and branch-mismatched assets are not release candidates", () => {
  const names = [
    "ffmpeg-n9.0-latest-linux64-lgpl-9.0.tar.xz",
    "ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz",
    "ffmpeg-n9.0-latest-linux64-gpl-8.1.tar.xz",
    "ffmpeg-master-latest-linux64-gpl.tar.xz",
  ];

  assert.throws(
    () => selectNewestBranch(names, LINUX_PATTERN, "BtbN linux64 GPL"),
    /No BtbN linux64 GPL asset matches/u,
  );
});

test("release versions and bare digests reject malformed feed bodies", () => {
  assert.equal(parseVersion("9.0.2\n", "version"), "9.0.2");
  assert.equal(parseVersion("8.1", "version"), "8.1");
  assert.throws(() => parseVersion("latest", "version"), /unexpected version/u);

  const digest = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
  assert.equal(parseDigest(`${digest}\n`, "checksum"), digest);
  assert.equal(parseDigest(digest.toUpperCase(), "checksum"), digest);
  assert.throws(() => parseDigest("abc123", "checksum"), /unexpected checksum/u);
});

test("a GitHub asset must publish a digest and a download URL", () => {
  const release = {
    tag_name: "2026.11.0",
    assets: [
      {
        name: "cloudflared-windows-amd64.exe",
        size: 55_397_592,
        digest: `sha256:${"a".repeat(64)}`,
        browser_download_url: "https://example.test/cloudflared.exe",
      },
      { name: "cloudflared-windows-386.exe", size: 1, digest: null },
    ],
  };

  assert.deepEqual(selectReleaseAsset(release, "cloudflared-windows-amd64.exe"), {
    url: "https://example.test/cloudflared.exe",
    digest: "a".repeat(64),
    size: 55_397_592,
  });
  assert.throws(
    () => selectReleaseAsset(release, "cloudflared-windows-386.exe"),
    / publishes no SHA-256 digest /u,
  );
  assert.throws(() => selectReleaseAsset(release, "missing.exe"), /does not publish missing\.exe/u);
});

test("the archive root is read from the listing instead of the version string", () => {
  const entries = [
    "ffmpeg-9.0.2-essentials_build/",
    "ffmpeg-9.0.2-essentials_build/LICENSE",
    "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe",
  ];

  assert.deepEqual(findArchiveRoot(entries, "ffmpeg.exe"), {
    root: "ffmpeg-9.0.2-essentials_build",
    binaryEntry: "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe",
  });
  assert.throws(() => findArchiveRoot(entries, "ffmpeg"), /does not contain bin\/ffmpeg\./u);
});
