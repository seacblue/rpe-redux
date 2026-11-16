/** Validate the current release changelog's bilingual structure and list format. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requestedVersion =
  process.argv[2] ?? JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const source = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const headings = [...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1]?.trim() ?? "");
if (headings.length !== 1 || headings[0] !== requestedVersion) {
  throw new Error(
    `CHANGELOG.md must contain exactly one release section for ${requestedVersion}; found ${headings.join(", ") || "none"}.`,
  );
}

const section =
  source.match(new RegExp(`^## ${escapeRegExp(requestedVersion)}\\s*$([\\s\\S]*)$`, "mu"))?.[1] ??
  "";
const chineseStart = section.indexOf("### 中文");
const englishStart = section.indexOf("### English");
if (chineseStart < 0 || englishStart < 0 || chineseStart > englishStart) {
  throw new Error("CHANGELOG.md must list ### 中文 before ### English.");
}

for (const [label, content] of [
  ["中文", section.slice(chineseStart, englishStart)],
  ["English", section.slice(englishStart)],
]) {
  if (!/^### .+$/mu.test(content) || !/^\*\*.+\*\*$/mu.test(content) || !/^- .+$/mu.test(content)) {
    throw new Error(`${label} changelog content must contain a category heading and bullet list.`);
  }
}

console.log(`Changelog check passed: ${requestedVersion} has bilingual release notes.`);

/** Escape a string before placing it in a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
