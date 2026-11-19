/** Stages the pinned FFmpeg build for the target desktop platform. */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { downloadVerifiedFile, hashFile } from "./fetchVerified.mjs";
import {
  findArchiveRoot,
  formatBytes,
  loadDependencyPins,
  selectFfmpegPin,
} from "./dependencyArtifacts.mjs";

// `--check` compares the pinned release with the staged build without
// contacting the network, so a slow link can still be inspected.
const checkOnly = process.argv.includes("--check");

/** Stage the release that matches the current target. */
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
  const distribution = selectFfmpegPin(loadDependencyPins(root), platform, arch);

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

  /** Read the version marker the staging step wrote, when one is present. */
  function readVersionMarker() {
    try {
      return readFileSync(join(targetDirectory, "VERSION.txt"), "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Return the stage record only while the staged files still match it.
   *
   * The stamp carries the archive digest that produced the binary and the digest
   * of the binary itself, so a hand-edited or partially replaced staging folder
   * fails the check instead of being reported as current.
   */
  async function verifiedStamp() {
    const stamp = readStamp();
    if (!stamp || typeof stamp.archiveHash !== "string" || typeof stamp.binaryHash !== "string") {
      return null;
    }
    const required = [
      binaryPath,
      join(targetDirectory, "LICENSE"),
      join(targetDirectory, "README.txt"),
    ];
    if (required.some((file) => !existsSync(file))) {
      return null;
    }
    return (await hashFile(binaryPath)) === stamp.binaryHash ? stamp : null;
  }

  const stamp = await verifiedStamp();
  const upToDate = stamp?.archiveHash === distribution.sha256;
  if (checkOnly) {
    const staged = stamp?.label ?? readVersionMarker() ?? "none";
    console.log(
      [
        `FFmpeg ${platform}/${arch}`,
        `  pinned  ${distribution.label} (${distribution.provider}, ${formatBytes(distribution.size)})`,
        `  staged  ${staged}${upToDate ? " (up to date)" : " (update available)"}`,
        `  sha256  ${distribution.sha256}`,
        `  source  ${distribution.archiveUrl}`,
      ].join("\n"),
    );
    return;
  }
  if (upToDate) {
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  // An offline archive is accepted only if it matches the pinned checksum.
  const suppliedArchive = process.env.REDUX_FFMPEG_ARCHIVE?.trim();
  const archivePath = suppliedArchive
    ? resolve(suppliedArchive)
    : join(cacheDirectory, distribution.archiveName);
  if (suppliedArchive) {
    if (!existsSync(archivePath) || (await hashFile(archivePath)) !== distribution.sha256) {
      throw new Error(
        "The supplied FFmpeg archive is missing or does not match the pinned checksum.",
      );
    }
  } else if (!existsSync(archivePath) || (await hashFile(archivePath)) !== distribution.sha256) {
    try {
      await downloadVerifiedFile({
        url: distribution.archiveUrl,
        destination: archivePath,
        expectedHash: distribution.sha256,
        label: "FFmpeg",
      });
    } catch (error) {
      if (stamp) {
        console.log(
          `Could not download the pinned FFmpeg build (${error.message}); ` +
            `keeping the staged ${stamp.label}.`,
        );
        return;
      }
      throw error;
    }
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
          `Distribution: ${distribution.label}`,
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
          `FFmpeg ${distribution.label} static build for ${platform}/${arch}.`,
          "",
          `Version: ${distribution.label}`,
          "License: GPL v3",
          `Source: ${distribution.archiveUrl}`,
          "",
        ].join("\n"),
      );
    }
    writeFileSync(join(targetDirectory, "VERSION.txt"), `${distribution.label}\n`);
    writeFileSync(
      stampPath,
      `${JSON.stringify(
        {
          label: distribution.label,
          archiveUrl: distribution.archiveUrl,
          archiveHash: distribution.sha256,
          binaryHash: await hashFile(binaryPath),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Staged FFmpeg ${distribution.label} in ${targetDirectory}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

await main();
