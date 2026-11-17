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
