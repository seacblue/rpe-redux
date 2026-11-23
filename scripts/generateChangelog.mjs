/**
 * Regenerate the bilingual release changelog for one version from the pending
 * Changesets, crediting the contributors those Changesets name or imply.
 */
import { join } from "node:path";
import { resolveContributors } from "./contributors.mjs";
import { changesetFiles, readChangeset, writeChangelogFromChangesets } from "./releaseNotes.mjs";

const root = join(import.meta.dirname, "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined;
if (!version) {
  throw new Error(
    "Usage: npm run release:changelog -- --version 1.1.0 (release:prepare derives the version and also bumps the manifests)",
  );
}

const offline = process.argv.includes("--offline");
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

const credits = offline
  ? new Map()
  : resolveContributors({
      root,
      changesets: pending,
      warn: (message) => console.warn(`warning: ${message}`),
    });
const changesets = pending.map((changeset) => ({
  ...changeset,
  contributors: changeset.contributors ?? credits.get(changeset.path) ?? [],
}));

writeChangelogFromChangesets(root, version, changesets);
console.log(
  `Generated CHANGELOG.md for ${version} from ${changesets.length} Changeset${changesets.length === 1 ? "" : "s"}.`,
);
for (const changeset of changesets.filter((entry) => entry.contributors.length > 0)) {
  const logins = changeset.contributors.map((login) => `@${login}`).join(", ");
  console.log(`Credits ${logins} (${changeset.label}).`);
}
