/**
 * Validate a pull request title against the repository's squash-only merge
 * policy: the pull request title becomes the commit subject on `main`, so it
 * has to read as a conventional commit before the branch is mergeable.
 */
const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];
const MAX_LENGTH = 120;
const PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9.-]*)\))?(?<breaking>!)?: (?<subject>\S.*)$/u;

const title = (process.argv[2] ?? process.env.PR_TITLE ?? "").trim();
if (!title) {
  throw new Error("No pull request title was supplied; pass it as an argument or PR_TITLE.");
}

const match = PATTERN.exec(title);
if (!match?.groups) {
  throw new Error(
    `Pull request title must read as "type(scope): subject"; got "${title}". Example: fix(editor): keep the saved camera view.`,
  );
}
if (!TYPES.includes(match.groups.type)) {
  throw new Error(
    `Pull request title uses the unknown type "${match.groups.type}"; use one of ${TYPES.join(", ")}.`,
  );
}
if (match.groups.subject.endsWith(".")) {
  throw new Error(`Pull request title subject must not end with a period; got "${title}".`);
}
if (title.length > MAX_LENGTH) {
  throw new Error(
    `Pull request title is ${title.length} characters; keep it under ${MAX_LENGTH} so the squashed commit subject stays readable.`,
  );
}

console.log(`Pull request title check passed: ${title}`);
