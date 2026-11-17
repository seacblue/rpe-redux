/** Read, compose, and validate the bilingual release notes that every release path shares. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Bump weights, ordered so the highest pending bump wins a release. */
const BUMPS = { patch: 1, minor: 2, major: 3 };

/**
 * Return the active Changeset files below `<root>/.changeset`, sorted by name.
 * The directory guide is documentation, not a Changeset.
 */
export function changesetFiles(root) {
  const directory = join(root, ".changeset");
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
    .sort()
    .map((file) => join(directory, file));
}

/** Extract the content below one language heading until the next language heading. */
function languageSection(body, heading) {
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

/** Merge category headings and their bullets from one language section. */
function collectCategories(categories, content) {
  let current;
  for (const line of content.split(/\r?\n/u)) {
    const category = /^\*\*(.+)\*\*$/u.exec(line.trim())?.[1];
    if (category) {
      current = categories.get(category);
      if (!current) {
        current = [];
        categories.set(category, current);
      }
      continue;
    }
    const item = line.trim();
    if (item.startsWith("- ") && current) {
      current.push(item.slice(2).trim());
    }
  }
}

/**
 * Parse one Changeset into its `rpe-redux` bump and bilingual sections.
 *
 * Both language sections are mandatory: the root changelog is published as the
 * GitHub release body and the desktop app renders the section that matches the
 * interface language, so a single-language Changeset would leave one of them
 * without notes. `label` names the file in error messages.
 */
export function readChangeset(path, label = path) {
  const source = readFileSync(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) {
    throw new Error(`${label} is missing a valid frontmatter block.`);
  }
  const bump = /["']?rpe-redux["']?\s*:\s*(major|minor|patch)\s*$/mu.exec(match[1] ?? "")?.[1];
  if (!bump) {
    throw new Error(`${label} must declare a major, minor, or patch bump for rpe-redux.`);
  }
  const body = match[2] ?? "";
  const chinese = languageSection(body, "中文");
  const english = languageSection(body, "English");
  for (const [name, content] of [
    ["中文", chinese],
    ["English", english],
  ]) {
    if (!content || !/^\*\*.+\*\*$/mu.test(content) || !/^- .+$/mu.test(content)) {
      throw new Error(
        `${label} must contain a non-empty ${name} section with a category and bullet.`,
      );
    }
  }
  return { path, label, bump, chinese, english };
}

/**
 * Collect the release-note categories for both languages, preserving the order
 * in which categories and bullets first appear.
 */
export function collectReleaseNotes(changesets) {
  const releases = { zh: new Map(), en: new Map() };
  for (const changeset of changesets) {
    collectCategories(releases.zh, changeset.chinese);
    collectCategories(releases.en, changeset.english);
  }
  return releases;
}

/** Return the highest bump declared by the given Changesets. */
export function releaseBump(changesets) {
  let highest = "patch";
  for (const { bump } of changesets) {
    if ((BUMPS[bump] ?? 0) > (BUMPS[highest] ?? 0)) {
      highest = bump;
    }
  }
  return highest;
}

/** Apply one release bump to a version, dropping any prerelease suffix. */
export function nextVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match) {
    throw new Error(`Cannot bump ${version}; expected a numeric release version.`);
  }
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/** Compare two release versions, returning a negative, zero, or positive number. */
export function compareVersions(left, right) {
  const parts = (value) =>
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u
      .exec(value)
      ?.slice(1, 5)
      .map((part, index) => (index === 3 ? (part ?? "") : Number(part))) ?? [];
  const a = parts(left);
  const b = parts(right);
  if (a.length === 0 || b.length === 0) {
    throw new Error(`Cannot compare ${left} with ${right}; both must be release versions.`);
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  if (a[3] === b[3]) {
    return 0;
  }
  if (a[3] === "") {
    return 1;
  }
  if (b[3] === "") {
    return -1;
  }
  return a[3] < b[3] ? -1 : 1;
}

/** Render one bilingual language section in the repository's release format. */
export function renderLanguageSection(heading, categories) {
  const lines = [`### ${heading}`];
  for (const [category, items] of categories) {
    lines.push("", `**${category}**`, "", ...items.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

/**
 * Compose a whole `CHANGELOG.md` from one release section, keeping the existing
 * preamble. The file carries a single release section because the release
 * workflow publishes it verbatim and the desktop changelog reads the same text.
 */
export function composeChangelog(existing, version, notes) {
  const preamble = existing.match(/^[\s\S]*?(?=^## )/mu)?.[0] ?? "# Changelog\n\n";
  return [
    preamble.trimEnd(),
    `## ${version}`,
    renderLanguageSection("中文", notes.zh),
    renderLanguageSection("English", notes.en),
    "",
  ].join("\n\n");
}

/**
 * Validate the release section for one version: exactly one section, Chinese
 * before English, and a category list in each language.
 */
export function validateChangelog(root, version) {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const headings = [...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1]?.trim() ?? "");
  if (headings.length !== 1 || headings[0] !== version) {
    throw new Error(
      `CHANGELOG.md must contain exactly one release section for ${version}; found ${headings.join(", ") || "none"}.`,
    );
  }
  const section =
    source.match(new RegExp(`^## ${escapeRegExp(version)}\\s*$([\\s\\S]*)$`, "mu"))?.[1] ?? "";
  const chineseStart = section.indexOf("### 中文");
  const englishStart = section.indexOf("### English");
  if (chineseStart < 0 || englishStart < 0 || chineseStart > englishStart) {
    throw new Error("CHANGELOG.md must list ### 中文 before ### English.");
  }
  for (const [label, content] of [
    ["中文", section.slice(chineseStart, englishStart)],
    ["English", section.slice(englishStart)],
  ]) {
    if (
      !/^### .+$/mu.test(content) ||
      !/^\*\*.+\*\*$/mu.test(content) ||
      !/^- .+$/mu.test(content)
    ) {
      throw new Error(
        `${label} changelog content must contain a category heading and bullet list.`,
      );
    }
  }
  return version;
}

/** Rewrite `CHANGELOG.md` with one section rendered from the given Changesets. */
export function writeChangelogFromChangesets(root, version, sortedChangesets) {
  const path = join(root, "CHANGELOG.md");
  const notes = collectReleaseNotes(sortedChangesets);
  writeFileSync(path, composeChangelog(readFileSync(path, "utf8"), version, notes), "utf8");
  validateChangelog(root, version);
  return path;
}

/** Escape a string before placing it in a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
