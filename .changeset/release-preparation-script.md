---
"rpe-redux": patch
---

### 中文

**代码质量**

- 新增 `npm run release:prepare`：一条命令同步五个版本文件、从待发布的 changeset 重建双语更新说明、删除已消费的 changeset 并自检，同时提供可在 Actions 里一键运行的「Release preparation」工作流。
- 新增「Pull request title」检查，确保 squash 合入后 main 上的提交标题符合约定式提交格式。
- 依赖升级按 patch/minor 分组为每周一个 PR；新增每周发布的依赖审计工作流。

### English

**Code quality**

- Add `npm run release:prepare`: one command syncs the five version files, rebuilds the bilingual release notes from the pending changesets, deletes the consumed files, and validates the result, together with a **Release preparation** workflow that runs it from the Actions tab.
- Add the **Pull request title** gate so the squashed commit subject on `main` follows the conventional commit format.
- Group dependency upgrades into one weekly pull request per ecosystem, and add a weekly dependency audit workflow.
