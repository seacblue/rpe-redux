---
"rpe-redux": patch
---

### 中文

**改进**

- 发布说明现在会署名贡献者：changeset 的 `### Contributors` 段决定署名对象，未写时按 PR 作者与 `Co-authored-by` 推导；正文里已经写过的 login 不会重复署名，bot 与维护者不署名。

### English

**Improvements**

- Release notes now credit contributors: a Changeset's `### Contributors` block names them, an unnamed Changeset credits the human pull request author and its `Co-authored-by` trailers, and a login the note already names, a bot, or a maintainer is never credited.
