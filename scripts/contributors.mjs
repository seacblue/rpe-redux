/**
 * Resolve the GitHub accounts a release credits for its Changesets.
 *
 * A Changeset can name its contributors in a `### Contributors` section. When it
 * does not, the release credits the human author of the pull request whose
 * squash commit added the file, plus every human `Co-authored-by` trailer on
 * that commit. Bots, repository maintainers, and logins the Changeset text
 * already names are left out, so an author who wrote the credit themselves is
 * never credited twice.
 *
 * Resolution reads local git history and, only when a Changeset needs an
 * automatic credit, the pull request through the authenticated `gh` CLI. A
 * missing CLI, token, or network returns no credit and a warning instead of
 * failing the release, so `npm run release:prepare` still works offline.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** GitHub logins: 1-39 letters, digits, or inner hyphens. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])$/u;

/** Co-author mail domains owned by coding agents rather than people. */
const BOT_MAIL_DOMAINS = ["commandcode.ai", "anthropic.com", "openai.com", "cursor.com"];

/** Automation accounts that do not always carry a `[bot]` suffix. */
const BOT_LOGINS = new Set([
  "changeset-bot",
  "copilot",
  "copilot-swe-agent",
  "dependabot",
  "github-actions",
  "renovate",
]);

/** Accounts that own the repository and never receive an automatic credit. */
export const MAINTAINER_LOGINS = ["seacblue"];

/** Return the bare login for a `@name` value, or null when it is not a login. */
export function normalizeLogin(value) {
  if (typeof value !== "string") {
    return null;
  }
  const login = value.trim().replace(/^@/u, "");
  return LOGIN.test(login) ? login : null;
}

/** Whether one resolved GitHub account is automation. */
export function isBotAccount({ login, type } = {}) {
  if (!login) {
    return true;
  }
  if (type === "Bot") {
    return true;
  }
  if (/\[bot\]$/iu.test(login)) {
    return true;
  }
  return BOT_LOGINS.has(login.toLowerCase());
}

/** Read the login out of a GitHub noreply address, or null for a real address. */
export function noreplyLogin(email) {
  const match = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/iu.exec(
    String(email ?? "").trim(),
  );
  return match ? normalizeLogin(match[1]) : null;
}

/** Extract the GitHub logins from the `Co-authored-by` trailers of a commit. */
export function coAuthorLogins(message, { botDomains = BOT_MAIL_DOMAINS } = {}) {
  const logins = [];
  for (const line of String(message ?? "").split(/\r?\n/u)) {
    const match = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/iu.exec(line.trim());
    if (!match) {
      continue;
    }
    const email = match[2].trim();
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    if (botDomains.some((value) => domain === value || domain.endsWith(`.${value}`))) {
      continue;
    }
    const login = noreplyLogin(email);
    if (login && !logins.some((value) => value.toLowerCase() === login.toLowerCase())) {
      logins.push(login);
    }
  }
  return logins;
}

/** Whether release-note text already names one login, which suppresses its credit. */
export function mentionsLogin(text, login) {
  return new RegExp(`@${login}(?![A-Za-z0-9-])`, "iu").test(String(text ?? ""));
}

/** Read one commit that added a Changeset, or null when git has no such commit. */
function commitReader(root) {
  return (label) => {
    const raw = execFileSync(
      "git",
      ["log", "--diff-filter=A", "-1", "--format=%ae%x1f%B", "--", label],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!raw) {
      return null;
    }
    const separator = raw.indexOf("\x1f");
    return {
      authorEmail: raw.slice(0, separator),
      message: raw.slice(separator + 1).trimEnd(),
    };
  };
}

/** Resolve the GitHub repository slug the pull request lookup asks about. */
function repositorySlug(root) {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/u.exec(remote);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

/** Read one pull request's author and account type through the `gh` CLI. */
function pullRequestLookup(root) {
  const repository = repositorySlug(root);
  return (number) => {
    if (!repository) {
      throw new Error("no GitHub repository is available");
    }
    const raw = execFileSync("gh", ["api", `repos/${repository}/pulls/${number}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const payload = JSON.parse(raw);
    return { login: payload.user?.login ?? "", type: payload.user?.type ?? "User" };
  };
}

/**
 * Resolve the credit list for every Changeset that does not name its own.
 *
 * Returns a map from the Changeset path to the ordered logins to credit, with
 * the pull request author first and co-authors after it. `changesets` are the
 * objects `readChangeset` returns: an explicit `contributors` array, including
 * an empty one, wins and skips resolution. `readCommit` and `lookupPullRequest`
 * are injection seams for tests that never touch git or the network.
 */
export function resolveContributors({
  root,
  changesets,
  readCommit = commitReader(root),
  lookupPullRequest = pullRequestLookup(root),
  maintainers = MAINTAINER_LOGINS,
  warn = () => {},
}) {
  const credits = new Map();
  const blocked = new Set(maintainers.map((login) => login.toLowerCase()));
  const pending = changesets.filter((changeset) => changeset.contributors === undefined);
  if (pending.length === 0 || !existsSync(join(root, ".git"))) {
    return credits;
  }

  let lookupFailure;
  const lookups = new Map();
  const lookup = (number) => {
    if (lookupFailure) {
      throw lookupFailure;
    }
    if (!lookups.has(number)) {
      try {
        lookups.set(number, lookupPullRequest(number));
      } catch (error) {
        lookupFailure = error;
        throw error;
      }
    }
    return lookups.get(number);
  };

  for (const changeset of pending) {
    const label = changeset.label ?? changeset.path;
    let commit;
    try {
      commit = readCommit(label);
    } catch (error) {
      warn(`${label}: cannot read the commit that adds it (${error.message}); no credit`);
      continue;
    }
    if (!commit) {
      warn(`${label}: no commit adds this Changeset; no credit`);
      continue;
    }

    const candidates = [];
    const pullRequest = /\(#(\d+)\)\s*$/u.exec(commit.message.split(/\r?\n/u)[0] ?? "")?.[1];
    if (pullRequest) {
      try {
        const author = lookup(pullRequest);
        if (author?.login) {
          candidates.push(author);
        }
      } catch (error) {
        warn(`${label}: cannot read pull request #${pullRequest} (${error.message}); no credit`);
        continue;
      }
    } else {
      const login = noreplyLogin(commit.authorEmail);
      if (login) {
        candidates.push({ login, type: "User" });
      }
    }
    for (const login of coAuthorLogins(commit.message)) {
      candidates.push({ login, type: "User" });
    }

    const credited = [];
    for (const candidate of candidates) {
      const login = normalizeLogin(candidate.login);
      if (!login || isBotAccount({ login, type: candidate.type })) {
        continue;
      }
      if (blocked.has(login.toLowerCase())) {
        continue;
      }
      if (credited.some((value) => value.toLowerCase() === login.toLowerCase())) {
        continue;
      }
      credited.push(login);
    }
    credits.set(changeset.path, credited);
  }
  return credits;
}
