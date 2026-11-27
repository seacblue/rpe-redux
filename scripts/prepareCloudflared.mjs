/** Stages the latest Cloudflare Tunnel release only for publishing; local builds never need its network lookup. */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { SKIPPED_TOOL_NOTE } from "./bundledTools.mjs";
import { downloadVerifiedFile, hashFile } from "./fetchVerified.mjs";
import {
  loadDependencySources,
  resolveLatestCloudflared,
  selectCloudflaredSource,
} from "./dependencyArtifacts.mjs";

// `--check` is intentionally offline. Release CI opts into the latest lookup.
const checkOnly = process.argv.includes("--check");
const releaseBuild = process.env.REDUX_RELEASE_BUILD === "1";

/** Stage the latest client that matches the current target. */
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
  const sources = loadDependencySources(root);
  const source = sources.cloudflared;
  const targetSource = selectCloudflaredSource(sources, platform, architecture);
  const executable = platform === "windows" ? "cloudflared.exe" : "cloudflared";
  const targetDirectory = join(root, "src-tauri", "resources", "cloudflared");
  const target = join(targetDirectory, executable);
  rmSync(join(targetDirectory, platform === "windows" ? "cloudflared" : "cloudflared.exe"), {
    force: true,
  });
  const cacheDirectory = join(root, ".local-tools", "cloudflared", `${platform}-${architecture}`);
  const stampPath = join(cacheDirectory, "staged.json");

  /** Read the release marker the staging step wrote, when one is present. */
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

  /** Return the stage record only while the staged client still matches it. */
  async function verifiedStamp() {
    const stamp = readStamp();
    if (!stamp || typeof stamp.binaryHash !== "string" || !existsSync(target)) {
      return null;
    }
    return (await hashFile(target)) === stamp.binaryHash ? stamp : null;
  }

  const stamp = await verifiedStamp();
  if (checkOnly) {
    console.log(
      [
        `Cloudflare Tunnel ${platform}/${architecture}`,
        `  source  ${source.repository}/${targetSource.name}`,
        `  staged  ${stamp?.label ?? readVersionMarker() ?? "none"}`,
        "  network latest lookup: skipped",
      ].join("\n"),
    );
    return;
  }
  if (!releaseBuild) {
    console.log(
      existsSync(target)
        ? `Local build keeps the staged Cloudflare Tunnel client for ${platform}/${architecture}; latest lookup skipped.`
        : `Local build leaves Cloudflare Tunnel unstaged for ${platform}/${architecture}; latest lookup skipped.`,
    );
    return;
  }

  const distribution = await resolveLatestCloudflared(sources, platform, architecture);
  const artifactKey = `${distribution.releaseUrl}#${distribution.archiveName}:${distribution.sha256 ?? distribution.size}`;
  const upToDate = stamp?.artifactKey === artifactKey;
  if (upToDate) {
    console.log(
      `Cloudflare Tunnel ${distribution.releaseTag} is already staged for ${platform}/${architecture}.`,
    );
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  const cache = join(cacheDirectory, distribution.archiveName);
  let digest;
  if (
    existsSync(cache) &&
    distribution.sha256 !== null &&
    (await hashFile(cache)) === distribution.sha256 &&
    statSync(cache).size === distribution.size
  ) {
    digest = await hashFile(cache);
    console.log(`Using cached Cloudflare Tunnel ${distribution.releaseTag} binary.`);
  } else {
    const result = await downloadVerifiedFile({
      url: distribution.archiveUrl,
      destination: cache,
      expectedHash: distribution.sha256,
      expectedSize: distribution.size,
      label: "cloudflared",
    });
    digest = result.sha256;
  }
  mkdirSync(targetDirectory, { recursive: true });
  rmSync(join(targetDirectory, SKIPPED_TOOL_NOTE), { force: true });
  copyFileSync(cache, target);
  if (platform !== "windows") {
    chmodSync(target, 0o755);
  }
  writeFileSync(
    join(targetDirectory, "VERSION.txt"),
    `${distribution.releaseTag} (${distribution.archiveName})\n`,
  );
  writeFileSync(
    stampPath,
    `${JSON.stringify(
      {
        label: `${distribution.releaseTag} ${distribution.archiveName}`,
        artifactKey,
        url: distribution.archiveUrl,
        size: distribution.size,
        digest,
        binaryHash: await hashFile(target),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Staged latest cloudflared ${distribution.releaseTag} (${platform}/${architecture})`);
}

await main();
