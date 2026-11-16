/** Validate active Changeset files and enforce the bilingual release-note contract. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const changesetDirectory = resolve(root, ".changeset");
const requireChangeset = process.argv.includes("--require");

/** Return active Changeset Markdown files, excluding the directory guide. */
function changesetFiles() {
  if (!existsSync(changesetDirectory)) {
    return [];
  }
  return readdirSync(changesetDirectory)
    .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
    .sort()
    .map((file) => resolve(changesetDirectory, file));
}

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

/** Parse one Changeset and return its package bump and bilingual body. */
function parseChangeset(file) {
  const source = readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) {
    throw new Error(`${file} is missing a valid frontmatter block.`);
  }
  const bump = /["']?rpe-redux["']?\s*:\s*(major|minor|patch)\s*$/mu.exec(match[1] ?? "")?.[1];
  if (!bump) {
    throw new Error(`${file} must declare a major, minor, or patch bump for rpe-redux.`);
  }
  const body = match[2] ?? "";
  const chinese = section(body, "中文");
  const english = section(body, "English");
  for (const [label, content] of [
    ["中文", chinese],
    ["English", english],
  ]) {
    if (!content || !/^\*\*.+\*\*$/mu.test(content) || !/^- .+$/mu.test(content)) {
      throw new Error(
        `${file} must contain a non-empty ${label} section with a category and bullet.`,
      );
    }
  }
  return { file, bump, body, chinese, english };
}

/** Extract the content below one language heading until the next language heading. */
function section(body, heading) {
  const lines = body.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start < 0) {
    return "";
  }
  const end = lines.findIndex((line, index) => index > start && /^### \S/u.test(line.trim()));
  return lines
    .slice(start + 1, end < 0 ? lines.length : end)
    .join("\n")
    .trim();
}

const files = changesetFiles();
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
  parseChangeset(file);
}

console.log(
  files.length === 0
    ? "Changeset check passed: no active changesets."
    : `Changeset check passed: ${files.length} active changeset${files.length === 1 ? "" : "s"}.`,
);
