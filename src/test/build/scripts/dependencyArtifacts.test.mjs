/** Verifies release-only dependency sources resolve future vendor assets without version pins. */
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  findArchiveRoot,
  loadDependencySources,
  resolveLatestCloudflared,
  resolveLatestFfmpeg,
  selectCloudflaredSource,
  selectFfmpegSource,
  selectReleaseAsset,
  validateDependencySources,
} from "../../../../scripts/dependencyArtifacts.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const sources = loadDependencySources(ROOT);

function fakeFetch(release) {
  return async () =>
    new Response(JSON.stringify(release), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function asset(name, size = 100, digest = "sha256:" + "a".repeat(64)) {
  return {
    name,
    size,
    digest,
    browser_download_url: `https://github.com/example/release/download/latest/${name}`,
  };
}

test("the source manifest covers every supported desktop target without versions", () => {
  assert.equal(sources.schemaVersion, 1);
  for (const entry of Object.values(sources.ffmpeg)) {
    assert.equal(typeof entry.repository, "string");
    assert.equal(typeof entry.assetPattern, "string");
    assert.equal("version" in entry, false);
    assert.equal("archiveUrl" in entry, false);
    assert.equal("sha256" in entry, false);
  }
  assert.equal(typeof sources.cloudflared.repository, "string");
  for (const entry of Object.values(sources.cloudflared.assets)) {
    assert.equal(typeof entry.name, "string");
    assert.equal("version" in entry, false);
    assert.equal("url" in entry, false);
    assert.equal("sha256" in entry, false);
  }
});

test("source selection reports unsupported targets", () => {
  assert.equal(selectFfmpegSource(sources, "windows", "x64").repository, "GyanD/codexffmpeg");
  assert.equal(
    selectCloudflaredSource(sources, "windows", "amd64").name,
    "cloudflared-windows-amd64.exe",
  );
  assert.throws(() => selectFfmpegSource(sources, "linux", "arm64"), /no FFmpeg build/u);
  assert.throws(
    () => selectCloudflaredSource(sources, "linux", "arm64"),
    /no Cloudflare Tunnel client/u,
  );
});

test("latest asset selection chooses the highest compatible version in one release", () => {
  const release = {
    assets: [
      asset("ffmpeg-n7.1-latest-win32-gpl-7.1.zip"),
      asset("ffmpeg-n9.0-latest-win32-gpl-9.0.zip"),
      asset("ffmpeg-n8.1-latest-win32-gpl-8.1.zip"),
    ],
  };
  const selected = selectReleaseAsset(release, sources.ffmpeg["windows-x86"], "FFmpeg");
  assert.equal(selected.name, "ffmpeg-n9.0-latest-win32-gpl-9.0.zip");
});

test("latest resolvers use release metadata and the optional GitHub digest", async () => {
  const release = {
    tag_name: "future-release",
    name: "Future release",
    html_url: "https://github.com/example/release",
    assets: [asset("ffmpeg-10.0-essentials_build.zip", 123)],
  };
  const resolved = await resolveLatestFfmpeg(sources, "windows", "x64", fakeFetch(release));
  assert.equal(resolved.releaseTag, "future-release");
  assert.equal(resolved.archiveName, "ffmpeg-10.0-essentials_build.zip");
  assert.equal(resolved.sha256, "a".repeat(64));
  assert.equal(resolved.size, 123);

  const tunnelRelease = {
    tag_name: "future-tunnel",
    html_url: "https://github.com/example/tunnel",
    assets: [asset("cloudflared-windows-amd64.exe", 456)],
  };
  const tunnel = await resolveLatestCloudflared(
    sources,
    "windows",
    "amd64",
    fakeFetch(tunnelRelease),
  );
  assert.equal(tunnel.releaseTag, "future-tunnel");
  assert.equal(tunnel.archiveName, "cloudflared-windows-amd64.exe");
});

test("validation rejects a missing target and malformed source", () => {
  const missingTarget = structuredClone(sources);
  delete missingTarget.ffmpeg["linux-x64"];
  assert.throws(
    () => validateDependencySources(missingTarget, "test sources"),
    /no FFmpeg source for linux-x64/u,
  );

  const insecureRepository = structuredClone(sources);
  insecureRepository.ffmpeg["windows-x64"].repository = "https://example.test";
  assert.throws(
    () => validateDependencySources(insecureRepository, "test sources"),
    /owner\/name/u,
  );

  const badSelection = structuredClone(sources);
  badSelection.ffmpeg["windows-x64"].selection = "pinned";
  assert.throws(() => validateDependencySources(badSelection, "test sources"), /selection/u);
});

test("the archive root is read from the listing instead of a version string", () => {
  const entries = [
    "ffmpeg-future-essentials/",
    "ffmpeg-future-essentials/LICENSE",
    "ffmpeg-future-essentials/bin/ffmpeg.exe",
  ];

  assert.deepEqual(findArchiveRoot(entries, "ffmpeg.exe"), {
    root: "ffmpeg-future-essentials",
    binaryEntry: "ffmpeg-future-essentials/bin/ffmpeg.exe",
  });
  assert.throws(() => findArchiveRoot(entries, "ffmpeg"), /does not contain bin\/ffmpeg\./u);
});
