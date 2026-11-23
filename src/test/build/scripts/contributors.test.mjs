/**
 * Verifies contributor identity handling: login normalization, bot and
 * maintainer filtering, co-author trailers, and the pull-request lookup that
 * credits an unnamed Changeset without failing the release when it is offline.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  coAuthorLogins,
  isBotAccount,
  mentionsLogin,
  normalizeLogin,
  noreplyLogin,
  resolveContributors,
} from "../../../../scripts/contributors.mjs";

/** Build one Changeset object with the fields resolution reads. */
function changeset(name, overrides = {}) {
  return {
    path: `/repo/.changeset/${name}.md`,
    label: `.changeset/${name}.md`,
    chinese: "**修复**\n\n- 修复。",
    english: "**Fixes**\n\n- Fixed.",
    contributors: undefined,
    ...overrides,
  };
}

/** Run one resolution against a throwaway root that looks like a git checkout. */
function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "redux-credit-"));
  mkdirSync(join(root, ".git"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("normalizes a login and rejects anything that is not one", () => {
  assert.equal(normalizeLogin("@alice"), "alice");
  assert.equal(normalizeLogin(" alice "), "alice");
  assert.equal(normalizeLogin("alice-smith"), "alice-smith");
  assert.equal(normalizeLogin(""), null);
  assert.equal(normalizeLogin("@"), null);
  assert.equal(normalizeLogin("alice smith"), null);
  assert.equal(normalizeLogin("a".repeat(40)), null);
  assert.equal(normalizeLogin("-alice"), null);
});

test("detects bot accounts by type, suffix, and known automation", () => {
  assert.equal(isBotAccount({ login: "dependabot[bot]", type: "Bot" }), true);
  assert.equal(isBotAccount({ login: "renovate", type: "User" }), true);
  assert.equal(isBotAccount({ login: "alice", type: "User" }), false);
  assert.equal(isBotAccount({}), true);
});

test("reads a login out of a GitHub noreply address", () => {
  assert.equal(noreplyLogin("123+alice@users.noreply.github.com"), "alice");
  assert.equal(noreplyLogin("alice@users.noreply.github.com"), "alice");
  assert.equal(noreplyLogin("alice@example.com"), null);
});

test("collects human co-authors and skips agent addresses", () => {
  const message = [
    "fix: thing",
    "",
    "Co-authored-by: Matrix <123+MatrixBlanchet@users.noreply.github.com>",
    "Co-authored-by: Agent <noreply@commandcode.ai>",
    "Co-authored-by: Matrix again <456+matrixblanchet@users.noreply.github.com>",
    "Co-authored-by: Human <human@example.com>",
  ].join("\n");
  assert.deepEqual(coAuthorLogins(message), ["MatrixBlanchet"]);
});

test("recognizes a login already named in release-note text", () => {
  assert.equal(mentionsLogin("由 @alice 贡献", "alice"), true);
  assert.equal(mentionsLogin("由 @alice 贡献", "bob"), false);
  assert.equal(mentionsLogin("mail alice@example.com", "alice"), false);
  assert.equal(mentionsLogin("@alice-smith 修复", "alice"), false);
});

test("credits the pull request author and human co-authors", () => {
  withRoot((root) => {
    const credits = resolveContributors({
      root,
      changesets: [changeset("first")],
      readCommit: () => ({
        authorEmail: "1+alice@users.noreply.github.com",
        message:
          "fix: thing (#12)\n\nCo-authored-by: Bob <2+Bob@users.noreply.github.com>\nCo-authored-by: Agent <noreply@commandcode.ai>",
      }),
      lookupPullRequest: () => ({ login: "alice", type: "User" }),
    });
    assert.deepEqual(credits.get("/repo/.changeset/first.md"), ["alice", "Bob"]);
  });
});

test("skips maintainers, bots, and explicit contributor lists", () => {
  withRoot((root) => {
    const credits = resolveContributors({
      root,
      changesets: [
        changeset("maintainer"),
        changeset("bot"),
        changeset("explicit", { contributors: ["dave"] }),
        changeset("opt-out", { contributors: [] }),
      ],
      readCommit: (label) => ({
        authorEmail: "",
        message: label.includes("maintainer") ? "fix: thing (#7)" : "fix: thing (#8)",
      }),
      lookupPullRequest: (number) =>
        number === 7
          ? { login: "seacblue", type: "User" }
          : { login: "dependabot[bot]", type: "Bot" },
    });
    assert.deepEqual(credits.get("/repo/.changeset/maintainer.md"), []);
    assert.deepEqual(credits.get("/repo/.changeset/bot.md"), []);
    assert.equal(credits.has("/repo/.changeset/explicit.md"), false);
    assert.equal(credits.has("/repo/.changeset/opt-out.md"), false);
  });
});

test("falls back to the commit author when the subject has no pull request", () => {
  withRoot((root) => {
    let lookedUp = false;
    const credits = resolveContributors({
      root,
      changesets: [changeset("direct")],
      readCommit: () => ({
        authorEmail: "321+carol@users.noreply.github.com",
        message: "feat: push straight to main",
      }),
      lookupPullRequest: () => {
        lookedUp = true;
        return null;
      },
    });
    assert.deepEqual(credits.get("/repo/.changeset/direct.md"), ["carol"]);
    assert.equal(lookedUp, false);
  });
});

test("warns and credits nobody when the pull request cannot be read", () => {
  withRoot((root) => {
    const warnings = [];
    const credits = resolveContributors({
      root,
      changesets: [changeset("unreadable")],
      readCommit: () => ({ authorEmail: "", message: "fix: thing (#99)" }),
      lookupPullRequest: () => {
        throw new Error("gh: not found");
      },
      warn: (message) => warnings.push(message),
    });
    assert.equal(credits.has("/repo/.changeset/unreadable.md"), false);
    assert.match(warnings[0], /pull request #99/u);
    assert.match(warnings[0], /no credit/u);
  });
});

test("does not touch git without a checkout or when a credit is explicit", () => {
  const plain = mkdtempSync(join(tmpdir(), "redux-credit-plain-"));
  let read = false;
  try {
    const credits = resolveContributors({
      root: plain,
      changesets: [changeset("first")],
      readCommit: () => {
        read = true;
        return null;
      },
    });
    assert.equal(credits.size, 0);
    assert.equal(read, false);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }

  withRoot((root) => {
    let read = false;
    const credits = resolveContributors({
      root,
      changesets: [changeset("explicit", { contributors: ["dave"] })],
      readCommit: () => {
        read = true;
        return null;
      },
    });
    assert.equal(credits.size, 0);
    assert.equal(read, false);
  });
});

test("warns when no commit adds the changeset", () => {
  withRoot((root) => {
    const warnings = [];
    const credits = resolveContributors({
      root,
      changesets: [changeset("orphan")],
      readCommit: () => null,
      warn: (message) => warnings.push(message),
    });
    assert.equal(credits.size, 0);
    assert.match(warnings[0], /no commit adds this Changeset/u);
  });
});
