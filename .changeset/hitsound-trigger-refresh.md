---
"rpe-redux": patch
---

### 中文

**修复**

- 从谱面库打开的分页谱面在增删改音符后，预览音效会按文档内容修订重建触发时间表：删除或移动的音符不再按旧位置发声，新增音符立即生效；分页加载只更新列表，不会打断已排队的音效。`chart.snapshot()` 也会在编辑后返回最新内容，不再返回首次读取的旧快照。

### English

**Fixes**

- Hit sounds in paged library charts now rebuild their trigger list from the document content revision after note edits: deleted or moved notes no longer sound at their old times and new notes apply immediately, while line materialization only refreshes the list without cutting queued voices. `chart.snapshot()` also returns the current chart after an edit instead of the first cached snapshot.
