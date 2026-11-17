---
"rpe-redux": patch
---

### 中文

**修复**

- 修复带 `attachUI`（`pause`、`combo`、`score` 等）或缺失可选资源的谱面无法导入的问题：宿主不再把谱面目录内不存在的文件当作可读资源，导入时读不到的资源会跳过，而不是让整次导入以 `os error 2` 失败。

### English

**Fixes**

- Fix charts that name `attachUI` UI bindings (`pause`, `combo`, `score`, and the like) or missing optional resources failing to import: the host no longer advertises non-existent in-folder files as readable resources, and an unreadable resource is skipped instead of failing the whole import with `os error 2`.
