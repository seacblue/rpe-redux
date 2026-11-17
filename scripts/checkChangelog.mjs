/** Validate the current release changelog's bilingual structure and list format. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateChangelog } from "./releaseNotes.mjs";

const root = join(import.meta.dirname, "..");
const version =
  process.argv[2] ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
validateChangelog(root, version);
console.log(`Changelog check passed: ${version} has bilingual release notes.`);
