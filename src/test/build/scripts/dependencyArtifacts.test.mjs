/**
 * Verifies the pinned dependency manifest: every supported desktop target names
 * an exact artifact with an HTTPS URL, a size, and a SHA-256 digest, so the
 * staging scripts never resolve a floating latest release.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  findArchiveRoot,
  loadDependencyPins,
  selectCloudflaredPin,
  selectFfmpegPin,
  validateDependencyPins,
} from "../../../../scripts/dependencyArtifacts.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const pins = loadDependencyPins(ROOT);

test("the pin manifest covers every supported desktop target", () => {
  assert.equal(pins.schemaVersion, 1);

  for (const [target, entry] of Object.entries(pins.ffmpeg)) {
    assert.equal(typeof entry.version, "string", target);
    assert.ok(entry.version.length > 0, target);
    assert.equal(typeof entry.label, "string", target);
    assert.equal(typeof entry.provider, "string", target);
    assert.ok(entry.archiveUrl.startsWith("https://"), target);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, target);
    assert.ok(entry.size > 0, target);
  }

  assert.equal(typeof pins.cloudflared.version, "string");
  for (const [target, entry] of Object.entries(pins.cloudflared.assets)) {
    assert.equal(typeof entry.name, "string", target);
    assert.ok(entry.url.startsWith("https://"), target);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, target);
    assert.ok(entry.size > 0, target);
  }
});

test("pins select the exact artifact for each supported target", () => {
  assert.equal(selectFfmpegPin(pins, "windows", "x64").version, "8.1.2");
  assert.equal(selectFfmpegPin(pins, "windows", "x86").version, "8.1.3");
  assert.equal(selectFfmpegPin(pins, "linux", "x64").version, "8.1.3");
  assert.equal(
    selectCloudflaredPin(pins, "windows", "amd64").name,
    "cloudflared-windows-amd64.exe",
  );
  assert.equal(selectCloudflaredPin(pins, "windows", "386").name, "cloudflared-windows-386.exe");
  assert.equal(selectCloudflaredPin(pins, "linux", "amd64").name, "cloudflared-linux-amd64");

  assert.throws(() => selectFfmpegPin(pins, "linux", "arm64"), /no FFmpeg build for linux\/arm64/u);
  assert.throws(
    () => selectCloudflaredPin(pins, "linux", "arm64"),
    /no Cloudflare Tunnel client for linux\/arm64/u,
  );
});

test("pinned URLs name the exact versioned artifact instead of a latest alias", () => {
  for (const entry of Object.values(pins.ffmpeg)) {
    assert.doesNotMatch(entry.archiveUrl, /\/releases\/download\/latest\//u);
    assert.ok(entry.archiveUrl.endsWith(`/${entry.archiveName}`));
    assert.ok(entry.archiveUrl.includes(entry.version));
  }
  for (const entry of Object.values(pins.cloudflared.assets)) {
    assert.ok(entry.url.endsWith(`/${entry.name}`));
    assert.ok(entry.url.includes(pins.cloudflared.version));
    assert.doesNotMatch(entry.url, /\/latest\//u);
  }
});

test("validation rejects a missing target and a malformed pin", () => {
  const missingTarget = structuredClone(pins);
  delete missingTarget.ffmpeg["linux-x64"];
  assert.throws(
    () => validateDependencyPins(missingTarget, "test pins"),
    /no FFmpeg pin for linux-x64/u,
  );

  const badDigest = structuredClone(pins);
  badDigest.cloudflared.assets["windows-amd64"].sha256 = "not-a-digest";
  assert.throws(() => validateDependencyPins(badDigest, "test pins"), /SHA-256 digest/u);

  const wrongName = structuredClone(pins);
  wrongName.ffmpeg["windows-x64"].archiveName = "other.zip";
  assert.throws(
    () => validateDependencyPins(wrongName, "test pins"),
    /URL does not name other\.zip/u,
  );

  const insecure = structuredClone(pins);
  insecure.ffmpeg["windows-x64"].archiveUrl =
    "http://example.test/ffmpeg-9.0.2-essentials_build.zip";
  assert.throws(() => validateDependencyPins(insecure, "test pins"), /HTTPS/u);
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
