/** Stages the newest verified upstream Cloudflare Tunnel client for the target build. */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { downloadVerifiedFile, hashFile } from "./fetchVerified.mjs";
import { fetchGitHubJson, formatBytes, selectReleaseAsset } from "./dependencyArtifacts.mjs";

const RELEASE_FEED = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
// `--check` resolves the newest release and compares it with the staged build
// without downloading the client, so a slow link can still be inspected.
const checkOnly = process.argv.includes("--check");

/** Release asset file names per target, matching the names Cloudflare publishes. */
const ASSETS = {
  windows: {
    amd64: "cloudflared-windows-amd64.exe",
    386: "cloudflared-windows-386.exe",
  },
  linux: {
    amd64: "cloudflared-linux-amd64",
  },
};

/** Stage the client that matches the current target. */
async function main() {
  const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.platform;
  const platform = targetTriple.includes("linux")
    ? "linux"
    : targetTriple.includes("windows") || targetTriple === "win32"
      ? "windows"
      : null;
  if (!platform) {
    console.log("Cloudflare Tunnel staging supports Windows and Linux targets only; skipping.");
    return;
  }
  // Windows ARM64 reuses the amd64 client through x64 emulation.
  const architecture =
    targetTriple.startsWith("i686") || targetTriple === "ia32"
      ? "386"
      : platform === "linux" && (targetTriple.includes("aarch64") || targetTriple === "arm64")
        ? "arm64"
        : "amd64";
  const assetName = ASSETS[platform]?.[architecture];
  if (!assetName) {
    throw new Error(`No Cloudflare Tunnel client for ${platform}/${architecture}.`);
  }

  const root = resolve(import.meta.dirname, "..");
  const executable = platform === "windows" ? "cloudflared.exe" : "cloudflared";
  const targetDirectory = join(root, "src-tauri", "resources", "cloudflared");
  const target = join(targetDirectory, executable);
  // Keep exactly one platform binary in the staged folder; a stale copy from an
  // earlier target would otherwise be bundled next to the new one.
  rmSync(join(targetDirectory, platform === "windows" ? "cloudflared" : "cloudflared.exe"), {
    force: true,
  });
  const cacheDirectory = join(root, ".local-tools", "cloudflared", `${platform}-${architecture}`);
  const stampPath = join(cacheDirectory, "staged.json");

  /** Read the version marker the staging step wrote, when one is present. */
  function readVersionMarker() {
    try {
      return readFileSync(join(targetDirectory, "VERSION.txt"), "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  /** Read the stage record that describes the currently staged client. */
  function readStamp() {
    try {
      return JSON.parse(readFileSync(stampPath, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * Return the stage record only while the staged client still matches it.
   *
   * The client is published as a bare executable, so its released digest is the
   * digest of the staged file itself; a stamp that no longer matches the bytes on
   * disk restages instead of reporting a stale version.
   */
  async function verifiedStamp() {
    const stamp = readStamp();
    if (!stamp || !/^[0-9a-f]{64}$/u.test(stamp.digest ?? "") || !existsSync(target)) {
      return null;
    }
    return (await hashFile(target)) === stamp.digest ? stamp : null;
  }

  let release;
  try {
    release = await fetchGitHubJson(RELEASE_FEED, "The Cloudflare Tunnel release feed");
  } catch (error) {
    const stamp = await verifiedStamp();
    if (!stamp || checkOnly) {
      throw error;
    }
    console.log(
      `Could not resolve the newest Cloudflare Tunnel client (${error.message}); ` +
        `keeping the staged ${stamp.label}.`,
    );
    return;
  }
  const version = String(release?.tag_name ?? "").trim();
  if (!/^\d{4}\.\d+\.\d+$/u.test(version)) {
    throw new Error(
      `The Cloudflare Tunnel release feed returned an unexpected version: ${version}.`,
    );
  }
  const asset = selectReleaseAsset(release, assetName);

  const stamp = await verifiedStamp();
  const upToDate = stamp?.digest === asset.digest;
  if (checkOnly) {
    const staged = stamp?.label ?? readVersionMarker() ?? "none";
    console.log(
      [
        `Cloudflare Tunnel ${platform}/${architecture}`,
        `  latest  ${version} (${formatBytes(asset.size)})`,
        `  staged  ${staged}${upToDate ? " (up to date)" : " (update available)"}`,
        `  sha256  ${asset.digest}`,
        `  source  ${asset.url}`,
      ].join("\n"),
    );
    return;
  }
  if (upToDate) {
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  const cache = join(cacheDirectory, assetName);
  if (!existsSync(cache) || (await hashFile(cache)) !== asset.digest) {
    console.log(`Downloading cloudflared ${version} for ${platform}/${architecture}...`);
    await downloadVerifiedFile({
      url: asset.url,
      destination: cache,
      expectedHash: asset.digest,
      label: "cloudflared",
    });
  }
  mkdirSync(targetDirectory, { recursive: true });
  copyFileSync(cache, target);
  if (platform !== "windows") {
    chmodSync(target, 0o755);
  }
  writeFileSync(join(targetDirectory, "VERSION.txt"), `${version}\n`);
  writeFileSync(
    stampPath,
    `${JSON.stringify({ label: version, url: asset.url, digest: asset.digest }, null, 2)}\n`,
  );
  console.log(`Staged cloudflared ${version} (${platform}/${architecture})`);
}

await main();
