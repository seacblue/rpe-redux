/** Validate active Changeset files and enforce the bilingual release-note contract. */
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { changesetFiles, readChangeset } from "./releaseNotes.mjs";

const root = join(import.meta.dirname, "..");
const requireChangeset = process.argv.includes("--require");

/** Read the files changed between the PR base and head when CI supplied both SHAs. */
function changedFiles() {
  const base = process.env.CHANGESET_BASE_SHA;
  const head = process.env.CHANGESET_HEAD_SHA;
  if (!base || !head) {
    return null;
  }
  return execFileSync("git", ["diff", "--name-only", base, head], {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .filter(Boolean);
}

const files = changesetFiles(root);
const changed = changedFiles();
if (requireChangeset) {
  const changedChangesets = (changed ?? []).filter(
    (file) => /^\.changeset\/[^/]+\.md$/u.test(file) && !file.endsWith("/README.md"),
  );
  if (changedChangesets.length === 0) {
    throw new Error("Every non-release pull request must add a .changeset/*.md file.");
  }
}

for (const file of files) {
  readChangeset(file, relative(root, file).split("\\").join("/"));
}

console.log(
  files.length === 0
    ? "Changeset check passed: no active changesets."
    : `Changeset check passed: ${files.length} active changeset${files.length === 1 ? "" : "s"}.`,
);
