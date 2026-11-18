---
"rpe-redux": patch
---

### 中文

**修复**

- 拖动“多线窗口宽度”时，时间轴窗口在拖动过程中实时改变宽度，不再等到松开鼠标。
- 多线分栏下，窗口宽度与横向滚动范围按左右两侧概览条之间的绘图区计算，位于两端的窗口不再被概览条遮挡。

### English

**Fixes**

- Dragging the multi-line window width resizes the timeline windows during the drag instead of waiting for the pointer to be released.
- In split multi-line layouts, the window width and horizontal scroll range are measured between the two overview strips, so windows at either end are no longer hidden underneath a strip.
