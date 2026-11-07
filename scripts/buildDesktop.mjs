/**
 * Builds the desktop product through the local Tauri CLI: resolves the output
 * mode and compiler profile, stages the sidecar and bundled resources, then
 * assembles the installer or portable folder the mode names.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { BUILD_HELP, parseBuildFlags } from "./buildFlags.mjs";
import { prepareDesktopPrerequisites } from "./desktopPrerequisites.mjs";
import { portableTarget, stagePortablePayload } from "./portablePayload.mjs";
import { runTauri } from "./tauriCli.mjs";

const root = resolve(import.meta.dirname, "..");
const flags = parseBuildFlags(process.argv.slice(2));
if (flags.help) {
  console.log(BUILD_HELP);
  process.exit(0);
}

const { mode, fast } = flags;
if (fast) {
  // Fast profile: the release feature set with thin LTO and parallel codegen.
  process.env.CARGO_PROFILE_RELEASE_LTO = "thin";
  process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "4";
  console.log("Fast release profile: thin LTO, 4 codegen units");
}
if (mode === "debug") {
  // A debug build keeps source maps for the debugger it serves.
  process.env.REDUX_SOURCEMAP = "1";
}

/**
 * Build the static documentation site before Tauri collects bundle resources.
 * The generator lands in `docs-site-dist/` and is owned by its own script.
 */
function buildDocsSite() {
  const script = join(root, "scripts", "buildDocsSite.mjs");
  if (!existsSync(script)) {
    throw new Error(
      `Documentation site builder is missing: ${script}. Add scripts/buildDocsSite.mjs before packaging.`,
    );
  }
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Documentation site build failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
  if (!existsSync(join(root, "docs-site-dist", "index.html"))) {
    throw new Error("Documentation site build did not produce docs-site-dist/index.html.");
  }
}

/** Assemble the portable folder from the release executable and bundled resources. */
function stagePortable() {
  const portableRoot = join(root, "release", "RPE-Redux-portable");
  const packageRoot = join(portableRoot, "RPE-Redux");
  const userData = join(packageRoot, "user-data");
  // Staging replaces the application files. User data (library, settings, Code Cell
  // token) lives beside them, so move it out of the package for the staging
  // window and restore it even when a copy fails.
  const preservedUserData = join(root, "release", ".RPE-Redux-user-data");
  if (!existsSync(userData) && existsSync(preservedUserData)) {
    renameSync(preservedUserData, userData);
  }
  const preserveUserData = existsSync(userData);
  if (preserveUserData) {
    rmSync(preservedUserData, { recursive: true, force: true });
    renameSync(userData, preservedUserData);
  }

  try {
    rmSync(portableRoot, { recursive: true, force: true });
    mkdirSync(packageRoot, { recursive: true });
    stagePortablePayload({ root, packageRoot, marker: true });
    // A portable launch resolves the documentation beside the executable, so
    // the folder carries the same generated site the installer bundles.
    const docsSite = join(root, "docs-site-dist");
    if (!existsSync(docsSite)) {
      throw new Error(`Portable build input is missing: ${docsSite}`);
    }
    cpSync(docsSite, join(packageRoot, "docs-site-dist"), { recursive: true });
  } finally {
    if (preserveUserData) {
      mkdirSync(packageRoot, { recursive: true });
      renameSync(preservedUserData, userData);
    }
  }
  console.log(`Portable build staged at ${packageRoot}`);
}

await prepareDesktopPrerequisites(root);
buildDocsSite();
// The release build names its bundles explicitly so a host with extra packagers
// installed still produces the supported installer set.
const releaseBundles =
  process.platform === "win32"
    ? ["--bundles", "nsis"]
    : process.platform === "linux"
      ? ["--bundles", "deb,rpm,appimage"]
      : [];
const tauriArgs =
  mode === "debug"
    ? ["build", "--debug", "--no-bundle"]
    : mode === "portable"
      ? ["build", "--no-bundle"]
      : ["build", ...releaseBundles];
runTauri(root, tauriArgs);

// Verify the assets inside the executable, rather than the mutable Vite output
// directory, before publishing a portable folder. Cross-target CI cannot execute
// a binary for another architecture and validates it on its target runner.
if (mode !== "debug" && !process.env.CARGO_BUILD_TARGET) {
  const { targetDirectory, executableName } = portableTarget(root);
  const executable = join(targetDirectory, executableName);
  const result = spawnSync(executable, ["--verify-embedded-entry"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error) {
    throw new Error(`Could not verify the desktop executable: ${executable}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`Desktop executable failed its embedded entry check: ${executable}`, {
      cause: new Error(`Asset check exited with status ${result.status ?? "unknown"}`),
    });
  }
  console.log("Verified embedded desktop entry page");
}

if (mode !== "debug") {
  stagePortable();
}
