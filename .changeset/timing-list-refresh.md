---
"rpe-redux": patch
---

### 中文

**修复**

- 修复时值面板的列表在修改时间偏移、新增或删除时值点后不刷新的问题。分页谱面在编辑后复用同一个门面对象，列表因此收不到变化；现在它跟随会话的内容修订号重建。

**变更**

- 「添加 BPM」改名为「添加时值点」，与列表里编辑的单位一致。

### English

**Fixes**

- The timing list now refreshes after an offset edit and after adding or deleting a timing point. A paged chart reuses one facade object across edits, so the list never saw a change; it now rebuilds from the session's content revision.

**Changed**

- "Add BPM" is now "Add timing point", matching the rows it creates.
