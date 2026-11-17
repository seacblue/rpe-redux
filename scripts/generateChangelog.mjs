/** Regenerate the bilingual release changelog for one version from the pending Changesets. */
import { join } from "node:path";
import { changesetFiles, readChangeset, writeChangelogFromChangesets } from "./releaseNotes.mjs";

const root = join(import.meta.dirname, "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined;
if (!version) {
  throw new Error(
    "Usage: npm run release:changelog -- --version 1.1.0 (release:prepare derives the version and also bumps the manifests)",
  );
}

const pending = changesetFiles(root).map((path) =>
  readChangeset(
    path,
    path
      .slice(root.length + 1)
      .split("\\")
      .join("/"),
  ),
);
if (pending.length === 0) {
  throw new Error("No active Changesets are available to generate release notes.");
}

writeChangelogFromChangesets(root, version, pending);
console.log(
  `Generated CHANGELOG.md for ${version} from ${pending.length} Changeset${pending.length === 1 ? "" : "s"}.`,
);
