/** Stages a verified Windows or Linux FFmpeg distribution for desktop builds. */
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

const root = resolve(import.meta.dirname, "..");
const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.platform;
const platform = targetTriple.includes("linux")
  ? "linux"
  : targetTriple.includes("windows") || targetTriple === "win32"
    ? "windows"
    : null;
if (!platform) {
  console.log("The bundled FFmpeg build supports Windows and Linux targets only; skipping.");
  process.exit(0);
}
// Windows ARM64 runs the pinned x64 encoder through its x64 emulation layer; a
// native ARM64 build would need a separate distribution.
const arch =
  targetTriple.startsWith("i686") || targetTriple === "ia32"
    ? "x86"
    : platform === "linux" && targetTriple.includes("aarch64")
      ? "arm64"
      : "x64";

const plans = {
  "windows-x64": {
    label: "8.1.2 x64",
    binary: "ffmpeg.exe",
    directory: "ffmpeg-8.1.2-essentials_build",
    url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
    archiveHash: "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
    binaryHash: "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e",
    licenseFile: "LICENSE",
    readmeFile: "README.txt",
    cache: join(root, ".local-tools", "ffmpeg", "ffmpeg-8.1.2-essentials_build.zip"),
  },
  "windows-x86": {
    label: "n8.1.3 x86",
    binary: "ffmpeg.exe",
    directory: "ffmpeg-n8.1.3-32-g760d10603e-win32-gpl-8.1",
    url:
      "https://github.com/defisym/FFmpeg-Builds-Win32/releases/download/" +
      "autobuild-2026-11-01-17-50/ffmpeg-n8.1.3-32-g760d10603e-win32-gpl-8.1.zip",
    archiveHash: "66f276bb20c5113e78c9d51577980b00b0d75b01a645fffc862ae364db8878c5",
    binaryHash: "1bb24af0836b5c3bedd2aaef6094f8418e3d774590d107548890b104f5541485",
    licenseFile: "LICENSE.txt",
    readmeFile: null,
    cache: join(
      root,
      ".local-tools",
      "ffmpeg",
      "x86",
      "ffmpeg-n8.1.3-32-g760d10603e-win32-gpl-8.1.zip",
    ),
  },
  "linux-x64": {
    label: "n8.1.3 x64 (BtbN GPL)",
    binary: "ffmpeg",
    directory: "ffmpeg-n8.1.3-32-g760d10603e-linux64-gpl-8.1",
    url:
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/" +
      "autobuild-2026-11-02-12-51/ffmpeg-n8.1.3-32-g760d10603e-linux64-gpl-8.1.tar.xz",
    archiveHash: "75cd1928804590b22209952f6f4eca3a68a36bc671cffa0d81426df1f6623881",
    binaryHash: "00afa954d2d3437e8e550afbe580bb57c404817fb9d895ee134a0f148ee1ae05",
    licenseFile: "LICENSE.txt",
    readmeFile: null,
    cache: join(
      root,
      ".local-tools",
      "ffmpeg",
      "linux",
      "ffmpeg-n8.1.3-32-g760d10603e-linux64-gpl-8.1.tar.xz",
    ),
  },
};
const plan = plans[`${platform}-${arch}`];
if (!plan) {
  throw new Error(`No pinned FFmpeg build for ${platform}/${arch}.`);
}
const target = join(root, "src-tauri", "resources", "ffmpeg");
const targetBinary = join(target, plan.binary);
// Keep exactly one platform binary in the staged folder; a stale copy from an
// earlier target would otherwise be bundled next to the new one.
rmSync(join(target, platform === "windows" ? "ffmpeg" : "ffmpeg.exe"), { force: true });
// An offline archive is accepted only if it matches the same pinned distribution.
const suppliedArchive = process.env.REDUX_FFMPEG_ARCHIVE?.trim();
const cache = suppliedArchive ? resolve(suppliedArchive) : plan.cache;

if (suppliedArchive && (!existsSync(cache) || (await hashFile(cache)) !== plan.archiveHash)) {
  throw new Error("The supplied FFmpeg archive is missing or its checksum does not match.");
}
const versionMarker = join(target, "VERSION.txt");
const stagedVersion = existsSync(versionMarker) ? readFileSync(versionMarker, "utf8").trim() : "";
if (
  stagedVersion === plan.label &&
  existsSync(targetBinary) &&
  existsSync(join(target, "LICENSE")) &&
  existsSync(join(target, "README.txt")) &&
  (await hashFile(targetBinary)) === plan.binaryHash
) {
  process.exit(0);
}
mkdirSync(dirname(cache), { recursive: true });
if (!existsSync(cache) || (await hashFile(cache)) !== plan.archiveHash) {
  await downloadVerifiedFile({
    url: plan.url,
    destination: cache,
    expectedHash: plan.archiveHash,
    label: "FFmpeg",
  });
}
const tempRoot = resolve(tmpdir());
const staging = mkdtempSync(join(tempRoot, "redux-ffmpeg-"));
if (dirname(resolve(staging)) !== tempRoot || !basename(staging).startsWith("redux-ffmpeg-")) {
  throw new Error("Invalid FFmpeg staging directory");
}
try {
  const listing = spawnSync("tar", ["-tf", cache], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (listing.status !== 0) {
    throw new Error("FFmpeg archive listing failed.");
  }
  const entries = new Set(listing.stdout.split(/\r?\n/));
  const binaryEntry = `${plan.directory}/bin/${plan.binary}`;
  const licenseEntry = plan.licenseFile ? `${plan.directory}/${plan.licenseFile}` : null;
  const readmeEntry = plan.readmeFile ? `${plan.directory}/${plan.readmeFile}` : null;
  const paths = [
    binaryEntry,
    ...[licenseEntry, readmeEntry].filter((entry) => entry && entries.has(entry)),
  ];
  const extract = spawnSync("tar", ["-xf", cache, "-C", staging, ...paths], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (extract.status !== 0) {
    throw new Error("FFmpeg archive extraction failed.");
  }
  const source = join(staging, plan.directory);
  if ((await hashFile(join(source, "bin", plan.binary))) !== plan.binaryHash) {
    throw new Error("FFmpeg binary checksum mismatch.");
  }
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, "bin", plan.binary), targetBinary);
  if (platform !== "windows") {
    chmodSync(targetBinary, 0o755);
  }
  if (licenseEntry && entries.has(licenseEntry)) {
    copyFileSync(join(source, plan.licenseFile), join(target, "LICENSE"));
  } else {
    writeFileSync(
      join(target, "LICENSE"),
      [
        "FFmpeg is licensed under the GNU General Public License.",
        "",
        `Distribution: ${plan.label}`,
        `Source: ${plan.url}`,
        "",
      ].join("\n"),
    );
  }
  if (readmeEntry && entries.has(readmeEntry)) {
    copyFileSync(join(source, plan.readmeFile), join(target, "README.txt"));
  } else {
    writeFileSync(
      join(target, "README.txt"),
      [
        `FFmpeg ${plan.label} static build for ${platform}/${arch}.`,
        "",
        `Version: ${plan.label}`,
        "License: GPL v3",
        `Source: ${plan.url}`,
        "",
      ].join("\n"),
    );
  }
  writeFileSync(versionMarker, `${plan.label}\n`);
  console.log(`Staged FFmpeg ${plan.label} in ${target}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
