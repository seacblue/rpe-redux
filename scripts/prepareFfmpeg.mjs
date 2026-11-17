/** Stages the newest verified upstream FFmpeg release for the target desktop platform. */
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
  fetchContentLength,
  fetchText,
  findArchiveRoot,
  formatBytes,
  parseChecksums,
  parseDigest,
  parseVersion,
  selectNewestBranch,
} from "./dependencyArtifacts.mjs";

const GYAN_BUILDS = "https://www.gyan.dev/ffmpeg/builds";
const BTBN_RELEASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/";
const DEFISYM_RELEASE = "https://github.com/defisym/FFmpeg-Builds-Win32/releases/download/latest/";
// `--check` resolves the newest release and compares it with the staged build
// without downloading the archive, so a slow link can still be inspected.
const checkOnly = process.argv.includes("--check");

/**
 * Resolve the newest Windows x64 essentials build gyan.dev publishes.
 *
 * gyan.dev serves one "release essentials" archive whose version and digest
 * change together; the `release-version` and `.sha256` endpoints name exactly
 * the bytes the archive URL returns right now.
 */
async function resolveWindowsX64() {
  const version = parseVersion(
    await fetchText(`${GYAN_BUILDS}/release-version`, { label: "The FFmpeg release version" }),
    "The gyan.dev release-version endpoint",
  );
  const archiveHash = parseDigest(
    await fetchText(`${GYAN_BUILDS}/ffmpeg-release-essentials.zip.sha256`, {
      label: "The FFmpeg release checksum",
    }),
    "The gyan.dev FFmpeg checksum",
  );
  return {
    label: `${version} x64 essentials`,
    archiveUrl: `${GYAN_BUILDS}/ffmpeg-release-essentials.zip`,
    archiveName: `ffmpeg-${version}-essentials.zip`,
    archiveHash,
    licenseFile: "LICENSE",
    readmeFile: "README.txt",
  };
}

/** Resolve the newest release-branch GPL build BtbN publishes for Linux x64. */
async function resolveLinuxX64() {
  const checksums = parseChecksums(
    await fetchText(`${BTBN_RELEASE}checksums.sha256`, { label: "The BtbN FFmpeg checksums" }),
  );
  const asset = selectNewestBranch(
    checksums.keys(),
    /^ffmpeg-n(\d+\.\d+)-latest-linux64-gpl-(\d+\.\d+)\.tar\.xz$/u,
    "BtbN linux64 GPL",
  );
  return {
    label: `n${asset.branch} x64 (BtbN GPL)`,
    archiveUrl: `${BTBN_RELEASE}${asset.name}`,
    archiveName: asset.name,
    archiveHash: checksums.get(asset.name),
    licenseFile: "LICENSE.txt",
    readmeFile: null,
  };
}

/** Resolve the newest win32 release-branch GPL build defisym publishes. */
async function resolveWindowsX86() {
  const checksums = parseChecksums(
    await fetchText(`${DEFISYM_RELEASE}checksums.sha256`, {
      label: "The win32 FFmpeg checksums",
    }),
  );
  const asset = selectNewestBranch(
    checksums.keys(),
    /^ffmpeg-n(\d+\.\d+)-latest-win32-gpl-(\d+\.\d+)\.zip$/u,
    "defisym win32 GPL",
  );
  return {
    label: `n${asset.branch} x86 (defisym GPL)`,
    archiveUrl: `${DEFISYM_RELEASE}${asset.name}`,
    archiveName: asset.name,
    archiveHash: checksums.get(asset.name),
    licenseFile: "LICENSE.txt",
    readmeFile: null,
  };
}

const resolvers = {
  "windows-x64": resolveWindowsX64,
  "windows-x86": resolveWindowsX86,
  "linux-x64": resolveLinuxX64,
};

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
  const resolver = resolvers[`${platform}-${arch}`];
  if (!resolver) {
    throw new Error(`No FFmpeg build source for ${platform}/${arch}.`);
  }

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

  let distribution;
  try {
    distribution = await resolver();
  } catch (error) {
    const stamp = await verifiedStamp();
    if (!stamp || checkOnly) {
      throw error;
    }
    console.log(
      `Could not resolve the newest FFmpeg release (${error.message}); ` +
        `keeping the staged ${stamp.label}.`,
    );
    return;
  }

  const stamp = await verifiedStamp();
  const upToDate = stamp?.archiveHash === distribution.archiveHash;
  if (checkOnly) {
    const size = await fetchContentLength(distribution.archiveUrl, {
      label: "The FFmpeg archive",
    });
    const staged = stamp?.label ?? readVersionMarker() ?? "none";
    console.log(
      [
        `FFmpeg ${platform}/${arch}`,
        `  latest  ${distribution.label}${size === null ? "" : ` (${formatBytes(size)})`}`,
        `  staged  ${staged}${upToDate ? " (up to date)" : " (update available)"}`,
        `  sha256  ${distribution.archiveHash}`,
        `  source  ${distribution.archiveUrl}`,
      ].join("\n"),
    );
    return;
  }
  if (upToDate) {
    return;
  }

  mkdirSync(cacheDirectory, { recursive: true });
  // An offline archive is accepted only if it matches the digest the publisher
  // ships for the distribution the build would download.
  const suppliedArchive = process.env.REDUX_FFMPEG_ARCHIVE?.trim();
  const archivePath = suppliedArchive
    ? resolve(suppliedArchive)
    : join(cacheDirectory, distribution.archiveName);
  if (suppliedArchive) {
    if (!existsSync(archivePath) || (await hashFile(archivePath)) !== distribution.archiveHash) {
      throw new Error(
        "The supplied FFmpeg archive is missing or does not match the newest upstream checksum.",
      );
    }
  } else if (
    !existsSync(archivePath) ||
    (await hashFile(archivePath)) !== distribution.archiveHash
  ) {
    await downloadVerifiedFile({
      url: distribution.archiveUrl,
      destination: archivePath,
      expectedHash: distribution.archiveHash,
      label: "FFmpeg",
    });
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
          archiveHash: distribution.archiveHash,
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
