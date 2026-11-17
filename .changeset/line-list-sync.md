---
"rpe-redux": patch
---

### 中文

**修复**

- 分页谱面新增、删除或重命名判定线和分组后，判定线树、工具栏判定线选择器和多行列表会立即同步；空分组也会显示。
- 导入或编辑资产后，资源树立即刷新，不再停留在旧内容。
- 新增判定线时自动展开所属分组并将新行滚入视野；新增分组后滚动到该分组。
- 分组左侧的折叠箭头不再绘制独立的悬停/按下底色，选中分组时跟随强调色。
- 判定线名称输入框按 Enter 立即提交。

**改进**

- 统一判定线树与资源树的子项行距，移除多选编辑中的冗余批量提示。

### English

**Fixes**

- Sync the judge-line tree, toolbar picker, and multi-line list immediately after adding, deleting, or renaming lines and groups in a paged chart; empty folders are listed too.
- Refresh the asset tree immediately after importing or editing assets instead of leaving stale rows.
- Expand a newly created line's folder and reveal the new row; reveal a newly added folder.
- Stop the folder disclosure chevron from painting its own hover/press fill and tint it with the folder selection instead.
- Commit the line name field on Enter.

**Improvements**

- Align row spacing in the judge-line and asset trees, and remove the redundant multi-select batch banner.
