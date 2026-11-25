/** Stages the latest FFmpeg release only for publishing; local builds never need its network lookup. */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { downloadVerifiedFile, hashFile } from "./fetchVerified.mjs";
import { SKIPPED_TOOL_NOTE } from "./bundledTools.mjs";
import {
  findArchiveRoot,
  loadDependencySources,
  resolveLatestFfmpeg,
  selectFfmpegSource,
} from "./dependencyArtifacts.mjs";

// `--check` is intentionally offline. Release CI opts into the latest lookup.
const checkOnly = process.argv.includes("--check");
const releaseBuild = process.env.REDUX_RELEASE_BUILD === "1";

/** Stage the latest release that matches the current target. */
async function main() {
  const root = resolve(import.meta.dirname, "..");
  const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.platform;
  const platform = targetTriple.includes("linux")
    ? "linux"
    : targetTriple.includes("windows") || targetTriple === "win32"
      ? "windows"
      : null;
  if (!platform) {
    console.log("The bundled FFmpeg build supports Windows and Linux targets only; skipping.");
    return;
  }
  // Windows ARM64 runs the x64 encoder through its x64 emulation layer; a
  // native ARM64 build would need a separate distribution.
  const arch =
    targetTriple.startsWith("i686") || targetTriple === "ia32"
      ? "x86"
      : platform === "linux" && targetTriple.includes("aarch64")
        ? "arm64"
        : "x64";
  const sources = loadDependencySources(root);
  const source = selectFfmpegSource(sources, platform, arch);

  const targetDirectory = join(root, "src-tauri", "resources", "ffmpeg");
  const binaryName = platform === "windows" ? "ffmpeg.exe" : "ffmpeg";
  const binaryPath = join(targetDirectory, binaryName);
  // Keep exactly one platform binary in the staged folder; a stale copy from an
  // earlier target would otherwise be bundled next to the new one.
  rmSync(join(targetDirectory, platform === "windows" ? "ffmpeg" : "ffmpeg.exe"), { force: true });

  const cacheDirectory = join(root, ".local-tools", "ffmpeg", `${platform}-${arch}`);
  const stampPath = join(cacheDirectory, "staged.json");

  /** Read the stage record that describes the currently staged binary. */
  function readStamp() {
    try {
      return JSON.parse(readFileSync(stampPath, "utf8"));
    } catch {
      return null;
    }
  }

  /** Read the release marker the staging step wrote, when one is present. */
  function readVersionMarker() {
    try {
      return readFileSync(join(targetDirectory, "VERSION.txt"), "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  /** Return the stage record only while the staged binary still matches it. */
  async function verifiedStamp() {
    const stamp = readStamp();
    if (!stamp || typeof stamp.binaryHash !== "string" || !existsSync(binaryPath)) {
      return null;
    }
    return (await hashFile(binaryPath)) === stamp.binaryHash ? stamp : null;
  }

  const stamp = await verifiedStamp();
  if (checkOnly) {
    console.log(
      [
        `FFmpeg ${platform}/${arch}`,
        `  source  ${source.repository} (${source.assetPattern})`,
        `  staged  ${stamp?.label ?? readVersionMarker() ?? "none"}`,
        "  network latest lookup: skipped",
      ].join("\n"),
    );
    return;
  }
  if (!releaseBuild) {
    console.log(
      existsSync(binaryPath)
        ? `Local build keeps the staged FFmpeg for ${platform}/${arch}; latest lookup skipped.`
        : `Local build leaves FFmpeg unstaged for ${platform}/${arch}; latest lookup skipped.`,
    );
    return;
  }

  const distribution = await resolveLatestFfmpeg(sources, platform, arch);
  const artifactKey = `${distribution.releaseUrl}#${distribution.archiveName}:${distribution.sha256 ?? distribution.size}`;
  const upToDate = stamp?.artifactKey === artifactKey;
  if (upToDate) {
    console.log(`FFmpeg ${distribution.releaseTag} is already staged for ${platform}/${arch}.`);
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  const archivePath = join(cacheDirectory, distribution.archiveName);
  let archiveHash;
  if (
    existsSync(archivePath) &&
    distribution.sha256 !== null &&
    (await hashFile(archivePath)) === distribution.sha256 &&
    statSync(archivePath).size === distribution.size
  ) {
    archiveHash = await hashFile(archivePath);
    console.log(`Using cached FFmpeg ${distribution.releaseTag} archive.`);
  } else {
    const result = await downloadVerifiedFile({
      url: distribution.archiveUrl,
      destination: archivePath,
      expectedHash: distribution.sha256,
      expectedSize: distribution.size,
      label: "FFmpeg",
    });
    archiveHash = result.sha256;
  }

  const tempRoot = resolve(tmpdir());
  const staging = mkdtempSync(join(tempRoot, "redux-ffmpeg-"));
  if (dirname(resolve(staging)) !== tempRoot || !basename(staging).startsWith("redux-ffmpeg-")) {
    throw new Error("Invalid FFmpeg staging directory");
  }
  try {
    const listing = spawnSync("tar", ["-tf", archivePath], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (listing.status !== 0) {
      throw new Error("FFmpeg archive listing failed.");
    }
    const entries = listing.stdout.split(/\r?\n/u).filter(Boolean);
    const { root: archiveRoot, binaryEntry } = findArchiveRoot(entries, binaryName);
    const licenseEntry = entries.find(
      (entry) => entry === `${archiveRoot}/${distribution.licenseFile}`,
    );
    const readmeEntry = distribution.readmeFile
      ? entries.find((entry) => entry === `${archiveRoot}/${distribution.readmeFile}`)
      : null;
    const paths = [binaryEntry, licenseEntry, readmeEntry].filter(Boolean);
    const extract = spawnSync("tar", ["-xf", archivePath, "-C", staging, ...paths], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (extract.status !== 0) {
      throw new Error("FFmpeg archive extraction failed.");
    }
    mkdirSync(targetDirectory, { recursive: true });
    rmSync(join(targetDirectory, SKIPPED_TOOL_NOTE), { force: true });
    copyFileSync(join(staging, binaryEntry), binaryPath);
    if (platform !== "windows") {
      chmodSync(binaryPath, 0o755);
    }
    if (licenseEntry) {
      copyFileSync(join(staging, licenseEntry), join(targetDirectory, "LICENSE"));
    } else {
      writeFileSync(
        join(targetDirectory, "LICENSE"),
        [
          "FFmpeg is licensed under the GNU General Public License.",
          "",
          `Distribution: ${distribution.archiveName}`,
          `Source: ${distribution.archiveUrl}`,
          "",
        ].join("\n"),
      );
    }
    if (readmeEntry) {
      copyFileSync(join(staging, readmeEntry), join(targetDirectory, "README.txt"));
    } else {
      writeFileSync(
        join(targetDirectory, "README.txt"),
        [
          `FFmpeg ${distribution.releaseTag} static build for ${platform}/${arch}.`,
          "",
          `Archive: ${distribution.archiveName}`,
          "License: GPL v3",
          `Source: ${distribution.archiveUrl}`,
          "",
        ].join("\n"),
      );
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
          archiveUrl: distribution.archiveUrl,
          archiveHash,
          binaryHash: await hashFile(binaryPath),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Staged latest FFmpeg ${distribution.releaseTag} in ${targetDirectory}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

await main();
