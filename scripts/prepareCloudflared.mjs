/** Stages the pinned Cloudflare Tunnel client for the target build. */
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
import { formatBytes, loadDependencyPins, selectCloudflaredPin } from "./dependencyArtifacts.mjs";

// `--check` compares the pinned release with the staged build without
// contacting the network, so a slow link can still be inspected.
const checkOnly = process.argv.includes("--check");

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

  const root = resolve(import.meta.dirname, "..");
  const pins = loadDependencyPins(root);
  const version = pins.cloudflared.version;
  const asset = selectCloudflaredPin(pins, platform, architecture);
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
   * The client is published as a bare executable, so its pinned digest is the
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

  const stamp = await verifiedStamp();
  const upToDate = stamp?.digest === asset.sha256;
  if (checkOnly) {
    const staged = stamp?.label ?? readVersionMarker() ?? "none";
    console.log(
      [
        `Cloudflare Tunnel ${platform}/${architecture}`,
        `  pinned  ${version} (${formatBytes(asset.size)})`,
        `  staged  ${staged}${upToDate ? " (up to date)" : " (update available)"}`,
        `  sha256  ${asset.sha256}`,
        `  source  ${asset.url}`,
      ].join("\n"),
    );
    return;
  }
  if (upToDate) {
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  const cache = join(cacheDirectory, asset.name);
  if (!existsSync(cache) || (await hashFile(cache)) !== asset.sha256) {
    console.log(`Downloading cloudflared ${version} for ${platform}/${architecture}...`);
    try {
      await downloadVerifiedFile({
        url: asset.url,
        destination: cache,
        expectedHash: asset.sha256,
        label: "cloudflared",
      });
    } catch (error) {
      if (stamp) {
        console.log(
          `Could not download the pinned Cloudflare Tunnel client (${error.message}); ` +
            `keeping the staged ${stamp.label}.`,
        );
        return;
      }
      throw error;
    }
  }
  mkdirSync(targetDirectory, { recursive: true });
  copyFileSync(cache, target);
  if (platform !== "windows") {
    chmodSync(target, 0o755);
  }
  writeFileSync(join(targetDirectory, "VERSION.txt"), `${version}\n`);
  writeFileSync(
    stampPath,
    `${JSON.stringify({ label: version, url: asset.url, digest: asset.sha256 }, null, 2)}\n`,
  );
  console.log(`Staged cloudflared ${version} (${platform}/${architecture})`);
}

await main();
