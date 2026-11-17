/**
 * Prepare one release: bump the shared product version, rebuild the bilingual
 * changelog from the pending Changesets, consume those Changesets, and validate
 * every release input the packaging workflow checks.
 *
 * The command is the single release-preparation path for a local checkout and
 * for the Release preparation workflow; it never tags, publishes, or builds.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { readProductVersion } from "./productVersion.mjs";
import {
  changesetFiles,
  compareVersions,
  nextVersion,
  readChangeset,
  releaseBump,
  validateChangelog,
  writeChangelogFromChangesets,
} from "./releaseNotes.mjs";

/**
 * Version manifest edits, in the order the release workflow validates them.
 * Each pattern captures the text before and after the single version value it
 * owns, so a manifest that changes shape fails loudly instead of silently
 * rewriting an unrelated number.
 */
const VERSION_FILES = [
  {
    path: ["package.json"],
    edits: [/^(\{\r?\n\s*"name":\s*"[^"]*",\r?\n\s*"version":\s*")[^"]*(")/u],
  },
  {
    path: ["package-lock.json"],
    edits: [
      /^(\{\r?\n\s*"name":\s*"[^"]*",\r?\n\s*"version":\s*")[^"]*(")/u,
      /(^\s*"packages":\s*\{\r?\n\s*"":\s*\{\r?\n\s*"name":\s*"[^"]*",\r?\n\s*"version":\s*")[^"]*(")/mu,
    ],
  },
  {
    path: ["src-tauri", "tauri.conf.json"],
    edits: [
      /^(\{\r?\n\s*"\$schema":\s*"[^"]*",\r?\n\s*"productName":\s*"[^"]*",\r?\n\s*"version":\s*")[^"]*(")/u,
    ],
  },
  {
    path: ["src-tauri", "Cargo.toml"],
    edits: [/^(version\s*=\s*")[^"]*(")/mu],
  },
  {
    path: ["src-tauri", "Cargo.lock"],
    edits: [/(\[\[package\]\]\r?\nname = "rpe-redux"\r?\nversion = ")[^"]*(")/u],
  },
];

/** Normalize a command-line or workflow version into a bare release version. */
export function normalizeVersion(value) {
  const version = value.trim().replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Unsupported release version: ${value}.`);
  }
  return version;
}

/** Apply one version value to every manifest that carries the product version. */
function applyVersion(root, version) {
  for (const file of VERSION_FILES) {
    const path = join(root, ...file.path);
    const label = file.path.join("/");
    let source = readFileSync(path, "utf8");
    for (const pattern of file.edits) {
      if (!pattern.test(source)) {
        throw new Error(
          `${label} no longer matches the release version pattern; update scripts/prepareRelease.mjs.`,
        );
      }
      source = source.replace(pattern, (_match, head, tail) => `${head}${version}${tail}`);
    }
    writeFileSync(path, source, "utf8");
  }
}

/** Read back every version a release input carries and fail on any drift. */
function readReleaseInputs(root) {
  const read = (...segments) => readFileSync(join(root, ...segments), "utf8");
  const packageLock = JSON.parse(read("package-lock.json"));
  const cargoLock = /\[\[package\]\]\r?\nname = "rpe-redux"\r?\nversion = "([^"]+)"/u.exec(
    read("src-tauri", "Cargo.lock"),
  )?.[1];
  return {
    product: readProductVersion(root),
    packageLock: packageLock.version,
    workspace: packageLock.packages?.[""]?.version,
    cargoLock,
  };
}

/**
 * Plan and apply one release preparation.
 *
 * Reads the active Changesets, derives the next version unless `version` is
 * given, rewrites the five version manifests and `CHANGELOG.md`, and deletes
 * the Changesets it consumed. `dryRun` reports the same plan without touching
 * the tree. `allowEmpty` releases hand-written notes when no Changeset is
 * pending; the existing changelog section then has to match the version.
 */
export function prepareRelease({
  root,
  version,
  dryRun = false,
  allowEmpty = false,
  log = () => {},
}) {
  const previousVersion = readProductVersion(root);
  const pending = changesetFiles(root).map((path) => {
    const label = relative(root, path).split("\\").join("/");
    return readChangeset(path, label);
  });
  if (pending.length === 0 && !allowEmpty) {
    throw new Error(
      "No active Changesets are available; add one with npm run changeset, or pass --allow-empty for hand-written release notes.",
    );
  }

  const bump = releaseBump(pending);
  const target = version ? normalizeVersion(version) : nextVersion(previousVersion, bump);
  if (compareVersions(target, previousVersion) <= 0) {
    throw new Error(`Release version ${target} must be newer than ${previousVersion}.`);
  }

  const plan = {
    previousVersion,
    version: target,
    bump,
    consumed: pending.map((changeset) => changeset.label),
    updated: VERSION_FILES.map((file) => file.path.join("/")),
    changelog: pending.length > 0,
  };

  if (dryRun) {
    log(`Would prepare ${target} from ${previousVersion} with a ${bump} bump.`);
    return plan;
  }

  log(`Preparing ${target} from ${previousVersion} with a ${bump} bump.`);
  applyVersion(root, target);
  if (plan.changelog) {
    writeChangelogFromChangesets(root, target, pending);
    log(`Rewrote CHANGELOG.md from ${pending.length} Changeset${pending.length === 1 ? "" : "s"}.`);
    for (const changeset of pending) {
      rmSync(changeset.path, { force: true });
    }
    plan.updated.push("CHANGELOG.md");
  } else {
    validateChangelog(root, target);
    log("Kept the hand-written CHANGELOG.md section; no Changeset was pending.");
  }

  const inputs = readReleaseInputs(root);
  for (const [name, value] of Object.entries(inputs)) {
    if (value !== target) {
      throw new Error(
        `Release version drift after preparation: ${name} is ${value}, expected ${target}.`,
      );
    }
  }
  return plan;
}

/** Parse the release-preparation command line. */
function parseArguments(argv) {
  const options = { dryRun: false, allowEmpty: false, version: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--allow-empty") {
      options.allowEmpty = true;
    } else if (argument === "--version") {
      options.version = argv[(index += 1)];
      if (!options.version) {
        throw new Error("--version requires a value.");
      }
    } else {
      throw new Error(
        `Unknown argument ${argument}. Usage: npm run release:prepare -- [--version 1.1.0] [--dry-run] [--allow-empty]`,
      );
    }
  }
  return options;
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const options = parseArguments(process.argv.slice(2));
  const plan = prepareRelease({
    root: join(import.meta.dirname, ".."),
    ...options,
    log: console.log,
  });
  console.log(
    `${options.dryRun ? "Would prepare" : "Prepared"} ${plan.version}: ${plan.updated.join(", ")}.`,
  );
  if (plan.consumed.length > 0) {
    console.log(
      `${options.dryRun ? "Would consume" : "Consumed"} ${plan.consumed.length} Changeset${plan.consumed.length === 1 ? "" : "s"}:`,
    );
    for (const changeset of plan.consumed) {
      console.log(`- ${changeset}`);
    }
  }
}
