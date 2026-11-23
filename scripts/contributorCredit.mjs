/**
 * Keep one pull request's contributor-credit notice current.
 *
 * The release credits a human pull request author automatically, so the notice
 * only has to say who will be credited and how to change or drop that credit.
 * A pull request without a Changeset gets a copy-ready template, because the
 * release gate rejects it. The command only comments through the API: it never
 * checks out or runs pull request code and never edits the contributor's files,
 * and a Changeset that already names its contributors is reported, not touched.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isBotAccount, MAINTAINER_LOGINS, normalizeLogin } from "./contributors.mjs";
import { parseChangesetSource } from "./releaseNotes.mjs";

/** HTML comment that lets the command find its own notice on later runs. */
const MARKER = "<!-- contributor-credit -->";

/** A Changeset path inside the pull request diff. */
const CHANGESET_FILE = /^\.changeset\/[^/]+\.md$/iu;

/** Run one authenticated `gh` command and return its stdout. */
function gh(args, { input } = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error.stderr ?? "").trim();
    const command = String(error.message ?? "").split(/\r?\n/u)[0];
    throw new Error(detail ? `${command}: ${detail}` : command, { cause: error });
  }
}

/** Return the notice a pull request needs, or a skip for maintainers and bots. */
export function creditPlan({
  author,
  authorType = "User",
  changesets,
  hasChangesetFile = changesets.length > 0,
  maintainers = MAINTAINER_LOGINS,
}) {
  const login = normalizeLogin(author);
  if (!login || isBotAccount({ login, type: authorType })) {
    return { kind: "skip", logins: [] };
  }
  if (maintainers.some((value) => value.toLowerCase() === login.toLowerCase())) {
    return { kind: "skip", logins: [] };
  }
  if (!hasChangesetFile) {
    return { kind: "missing", author: login, logins: [] };
  }
  const recorded = [];
  for (const changeset of changesets) {
    for (const entry of changeset.contributors ?? []) {
      if (!recorded.some((value) => value.toLowerCase() === entry.toLowerCase())) {
        recorded.push(entry);
      }
    }
  }
  if (changesets.some((changeset) => changeset.contributors !== undefined)) {
    return { kind: "recorded", author: login, logins: recorded };
  }
  return { kind: "suggested", author: login, logins: [login] };
}

/** Render the Markdown body of one notice. */
export function creditComment({ plan }) {
  if (plan.kind === "missing") {
    return `${MARKER}
### Contributor credit

This pull request does not add a \`.changeset/*.md\` file, which the release notes require. Copy the block below into \`.changeset/<name>.md\`, replace the two placeholder lines, and commit it.

~~~markdown
---
"rpe-redux": patch
---

### 中文

**修复**

- 中文说明。

### English

**Fixes**

- English description.

### Contributors

- @${plan.author}
~~~

The next release credits **@${plan.author}** automatically unless the \`### Contributors\` section lists different logins. Leave the section empty to skip the credit. This bot never edits the Changeset file.`;
  }
  if (plan.kind === "recorded") {
    const names = plan.logins.map((login) => `@${login}`).join(", ");
    return `${MARKER}
### Contributor credit

${names ? `Recorded from the Changeset: ${names}.` : "The Changeset opts this change out of the automatic credit."} The release uses those logins as written.

This bot never edits the Changeset file.`;
  }
  return `${MARKER}
### Contributor credit

The next release credits **@${plan.author}** for this change automatically; nothing to do if that is right.

- To credit someone else, add this section to the Changeset (both languages share it):

  ~~~markdown
  ### Contributors

  - @login
  ~~~

- To skip the credit, leave the section with no bullet.

This bot never edits the Changeset file.`;
}

/** Read the Changesets a pull request adds or changes. */
function pullRequestChangesets(repository, headSha, paths) {
  const changesets = [];
  for (const path of paths) {
    try {
      const encoded = gh([
        "api",
        `repos/${repository}/contents/${path}?ref=${headSha}`,
        "--jq",
        ".content",
      ]);
      const source = Buffer.from(encoded, "base64").toString("utf8");
      changesets.push({ path, ...parseChangesetSource(source, path) });
    } catch (error) {
      console.warn(`Ignoring ${path}: ${error.message}`);
    }
  }
  return changesets;
}

/** Publish or update the one notice this command owns on the pull request. */
function publish(repository, number, body) {
  const existing = gh([
    "api",
    "--paginate",
    `repos/${repository}/issues/${number}/comments?per_page=100`,
    "--jq",
    `.[] | select(.body | contains("${MARKER}")) | .id`,
  ])
    .split(/\r?\n/u)
    .filter(Boolean)[0];
  const target = existing
    ? `repos/${repository}/issues/comments/${existing}`
    : `repos/${repository}/issues/${number}/comments`;
  gh(["api", "--method", existing ? "PATCH" : "POST", target, "--input", "-"], {
    input: JSON.stringify({ body }),
  });
}

/** Publish the notice for one pull request, or skip a release-preparation pull request. */
function publishNotice({ repository, number, author, title, headSha, dryRun }) {
  if (title.startsWith("chore(release): ")) {
    console.log("Release preparation consumes Changesets; no credit notice.");
    return;
  }
  const files = gh([
    "api",
    "--paginate",
    `repos/${repository}/pulls/${number}/files?per_page=100`,
    "--jq",
    ".[].filename",
  ])
    .split(/\r?\n/u)
    .filter(Boolean);
  const paths = files.filter((file) => CHANGESET_FILE.test(file) && !/readme\.md$/iu.test(file));
  const changesets = pullRequestChangesets(repository, headSha, paths);
  const plan = creditPlan({
    author,
    authorType: process.env.PR_AUTHOR_TYPE ?? "User",
    changesets,
    hasChangesetFile: paths.length > 0,
  });
  if (plan.kind === "skip") {
    console.log("Maintainer or bot pull request; no credit notice.");
    return;
  }
  const body = creditComment({ plan });
  if (dryRun) {
    console.log(`Would publish the ${plan.kind} notice:\n\n${body}`);
    return;
  }
  publish(repository, number, body);
  console.log(`Contributor credit notice: ${plan.kind}.`);
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const repository = process.env.REPOSITORY;
  const number = process.env.PR_NUMBER;
  const author = process.env.PR_AUTHOR;
  if (!repository || !number || !author) {
    throw new Error("REPOSITORY, PR_NUMBER, and PR_AUTHOR are required.");
  }
  try {
    publishNotice({
      repository,
      number,
      author,
      title: process.env.PR_TITLE ?? "",
      headSha: process.env.PR_HEAD_SHA ?? "",
      dryRun: process.argv.includes("--dry-run"),
    });
  } catch (error) {
    // The notice is advisory: an API failure must not turn a pull request red.
    console.warn(`::warning::Contributor credit notice skipped: ${error.message}`);
  }
}
