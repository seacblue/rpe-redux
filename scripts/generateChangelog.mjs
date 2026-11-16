/** Generate the repository's bilingual release changelog from active Changesets. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = argument("version");
if (!version) {
  throw new Error("Usage: npm run release:changelog -- --version 1.0.11 [--date YYYY-MM-DD]");
}
const date = argument("date");
const changesetDirectory = resolve(root, ".changeset");
const files = existsSync(changesetDirectory)
  ? readdirSync(changesetDirectory)
      .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
      .sort()
  : [];
if (files.length === 0) {
  throw new Error("No active Changesets are available to generate release notes.");
}

const releases = { zh: new Map(), en: new Map() };
for (const file of files) {
  const body = readFileSync(resolve(changesetDirectory, file), "utf8").replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n/u,
    "",
  );
  collect(releases.zh, languageSection(body, "中文"));
  collect(releases.en, languageSection(body, "English"));
}

const existing = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const preamble = existing.match(/^[\s\S]*?(?=^## )/mu)?.[0] ?? "# Changelog\n\n";
const output = [
  preamble.trimEnd(),
  `## ${version}${date ? ` (${date})` : ""}`,
  renderLanguage("中文", releases.zh),
  renderLanguage("English", releases.en),
  "",
].join("\n\n");
writeFileSync(resolve(root, "CHANGELOG.md"), output, "utf8");
console.log(
  `Generated CHANGELOG.md for ${version} from ${files.length} Changeset${files.length === 1 ? "" : "s"}.`,
);

/** Return one CLI option value. */
function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Extract one language section from a Changeset body. */
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

/** Merge category headings and bullets from one language section. */
function collect(categories, content) {
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

/** Render one bilingual language section in the repository's release format. */
function renderLanguage(heading, categories) {
  const lines = [`### ${heading}`];
  for (const [category, items] of categories) {
    lines.push("", `**${category}**`, "", ...items.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
