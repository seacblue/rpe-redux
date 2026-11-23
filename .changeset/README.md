# Changesets

Every pull request that changes the product must add one Markdown file in this directory. Release-preparation pull requests are the only exception because they consume the pending changesets.

Use the Changesets CLI to create one:

```text
npm run changeset
```

Each changeset must include the package bump in its frontmatter and both release-note sections:

```markdown
---
"rpe-redux": patch
---

### 中文

**修复**

- 中文说明。

### English

**Fixes**

- English description.
```

The PR gate checks the file and requires at least one changeset on every non-release pull request. `npm run release:prepare` consumes the active files: it generates the bilingual root `CHANGELOG.md`, bumps every product version input, and deletes the files it consumed.

## Contributors

The next release credits the human author of the pull request that adds the file automatically, together with any human `Co-authored-by` trailer on the squash commit. Bots and repository maintainers are never credited.

To credit someone else, add a language-neutral block at the end of the file:

```markdown
### Contributors

- @alice
```

An empty block opts the change out of the credit. The release copies the names into both languages: once at the end of the change's last bullet and once in the `贡献者` / `Contributors` category that closes the section. A login the note text already names is not credited again, so a hand-written thanks stays the only mention.

The **Contributor credit** workflow comments the current credit, and a copy-ready Changeset template when the pull request has none. It never edits the file.
