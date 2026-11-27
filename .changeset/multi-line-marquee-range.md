---
"rpe-redux": patch
---

### 中文

**修复**

- 修复多线编辑下框选事件时只选中当前屏幕内事件的问题：框选现在按拖动覆盖的完整拍范围查询每条可见轨道，屏幕外的事件不再被丢弃。

### English

**Fixes**

- Fixed multi-line event marquee selection only taking the events currently on screen: the marquee now queries every visible track over the whole dragged beat range, so events outside the viewport are no longer dropped.
