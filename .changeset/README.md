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

The PR gate checks the file and requires at least one changeset on every non-release pull request. Release preparation uses the active changesets to generate the bilingual root `CHANGELOG.md` before versioning.
