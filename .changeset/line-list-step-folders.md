---
"rpe-redux": patch
---

### 中文

**新增**

- 判定线输入框支持 `X:Y/Z` 步长范围（省略 `/Z` 时为 1，尾端包含），并可直接输入分组名；点击分组也会整组加入或移除。
- 新建或重命名分组时会静默剔除逗号与括号（`,`、`，`、`()`、`（）`），不再报错，分组名始终可以写进线号列表。
- 线号列表保持手写顺序：单条加入追加到末尾，大段加入先去掉列表内的重叠再追加，删除在原文位置切分，不再自动合并或排序。
- 多线编辑、工具栏线号框和分组点击共享同一份保序表达式；保存时仍写回 RPE 可读的数字范围。

### English

**Added**

- The judge-line field accepts `X:Y/Z` step ranges (`Z` defaults to 1 and the end is inclusive) and folder names; clicking a folder adds or removes the whole folder.
- Creating or renaming a folder silently strips commas and parentheses, so every folder name can be written in the line list without an error.
- The line list keeps the authored order: a single line appends, a block strips its overlap from the list and appends, and a removal splices the affected range in place. Tokens are never merged or sorted.
- Multi-line editing, the toolbar line field, and folder clicks share one ordered expression; saving still writes the numeric range syntax native RPE reads.
