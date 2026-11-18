---
"rpe-redux": patch
---

### 中文

**改进**

- 减少时间线绘制每个音符和事件时的重复检查与分配：仅在重叠选择器打开时查询悬停项，协作选择为空时跳过查找，并复用绘制参数对象。

### English

**Improvements**

- Reduce the per-note and per-event bookkeeping in the timeline paint loop: the overlap hover state is queried only while the overlap picker is open, remote collaboration selections are skipped when empty, and the paint options object is reused instead of allocated per item.
