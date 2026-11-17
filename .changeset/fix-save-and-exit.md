---
"rpe-redux": patch
---

### 中文

**修复**

- 修复后台自动保存进行中点击“保存并退出”后，保存完成却仍提示存在未保存修改的问题。
- 隔离普通保存、另存为、导出和后台备份的并发请求，避免不同保存意图复用错误结果。

### English

**Fixes**

- Fix “Save and Exit” reporting unsaved changes when a background backup was already in progress.
- Keep regular saves, Save As, exports, and background backups from sharing results across different persistence intents.
